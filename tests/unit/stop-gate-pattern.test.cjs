'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const stopGate = require('../../src/opencode/stop-gate-pattern.cjs');
const plugin = require('../../src/opencode/pipeline-adaptation-plugin.cjs');
const opencodeIndex = require('../../src/opencode/index.cjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function sentinel(overrides = {}) {
  return {
    schemaVersion: 'SENTINEL_STATE/v1',
    runId: 'run-stop-pattern',
    currentPhase: 'phase_stop_check',
    checkpoints: {},
    blocked: false,
    stopRuleTriggered: false,
    lastValidEventId: null,
    updatedAt: new Date().toISOString(),
    pipeline_active: true,
    workflow_key: 'FULL',
    task_type: 'feature',
    complexity: 'medium',
    ...overrides,
  };
}

function projectWithState(state) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w7-1-stop-'));
  const runDir = path.join(project, '.pipeline', 'docs', 'Pre-feature-action', state.runId || 'run-stop-pattern');
  const statePath = path.join(runDir, 'sentinel-state.json');
  writeJson(statePath, state);
  writeJson(path.join(project, '.pipeline', 'active-run.json'), { pipeline_doc_path: runDir });
  return { project, runDir, statePath };
}

function idleInput(project) {
  return { cwd: project, event: { type: 'session.idle', properties: { reason: 'user_stop' } } };
}

let output = {};
stopGate.handleSessionIdle({ cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'po-w7-1-no-state-')), event: 'session.idle' }, output);
assert.equal(output.error, undefined);

const governed = projectWithState(sentinel());
stopGate.handleSessionIdle(idleInput(governed.project), {}, { nowIso: '2026-06-24T00:10:00.000Z' });
let events = readJsonl(path.join(governed.runDir, 'protocol-events.jsonl'));
assert.equal(events.length, 1);
assert.equal(events[0].event, 'PIPELINE_STOP_ATTEMPT');
assert.equal(events[0].run_id, 'run-stop-pattern');
assert.equal(events[0].phase, 'phase_stop_check');
assert.equal(events[0].continuity_attempt, 1);
assert.equal(events[0].mode, 'observer_only');
let state = readJson(governed.statePath);
assert.equal(state.continuity_attempts, 1);
assert.equal(state.terminal_state, undefined);

stopGate.handleSessionIdle(idleInput(governed.project), {}, { nowIso: '2026-06-24T00:11:00.000Z' });
stopGate.handleSessionIdle(idleInput(governed.project), {}, { nowIso: '2026-06-24T00:12:00.000Z' });
state = readJson(governed.statePath);
assert.equal(state.continuity_attempts, 3);
assert.equal(state.terminal_state, 'hard_failed');
assert.equal(state.status, 'hard_failed');
events = readJsonl(path.join(governed.runDir, 'protocol-events.jsonl'));
assert.equal(events.length, 3);
assert.equal(events[2].terminal_state, 'hard_failed');

const completed = projectWithState(sentinel({ runId: 'run-stop-complete', terminal_state: 'completed', status: 'completed' }));
stopGate.handleSessionIdle(idleInput(completed.project), {}, { nowIso: '2026-06-24T00:13:00.000Z' });
assert.equal(fs.existsSync(path.join(completed.runDir, 'protocol-events.jsonl')), false);

const hooks = stopGate.createStopGatePatternHooks({ projectDir: () => governed.project, nowIso: '2026-06-24T00:14:00.000Z' });
assert.equal(typeof hooks.event, 'function');
assert.equal(typeof hooks['session.idle'], 'function');

const pluginProject = projectWithState(sentinel({ runId: 'run-stop-plugin' }));
const pluginHooks = plugin.createPipelineAdaptationHooks({ directory: pluginProject.project }, { nowIso: '2026-06-24T00:15:00.000Z' });
pluginHooks.event(idleInput(pluginProject.project), {});
assert.equal(readJsonl(path.join(pluginProject.runDir, 'protocol-events.jsonl'))[0].event, 'PIPELINE_STOP_ATTEMPT');

assert.equal(typeof opencodeIndex.createStopGatePatternHooks, 'function');

async function assertOpenCodePluginFileRegistersStopGate() {
  const pluginFile = path.join(__dirname, '..', '..', '.opencode', 'plugins', 'pipeline-adaptation-plugin.js');
  const pluginModule = await import(pathToFileURL(pluginFile).href);
  const fileProject = projectWithState(sentinel({ runId: 'run-stop-file-plugin' }));
  const hooksFromFile = await pluginModule.default({ directory: fileProject.project }, { nowIso: '2026-06-24T00:16:00.000Z' });
  hooksFromFile.event(idleInput(fileProject.project), {});
  assert.equal(readJsonl(path.join(fileProject.runDir, 'protocol-events.jsonl'))[0].event, 'PIPELINE_STOP_ATTEMPT');
}

const skillText = fs.readFileSync(path.join(__dirname, '..', '..', '.opencode', 'skills', 'pipeline-orchestrator', 'SKILL.md'), 'utf8');
assert.match(skillText, /PIPELINE_STOP_ATTEMPT/);
assert.match(skillText, /observer-only/);

const opencodeConfig = readJson(path.join(__dirname, '..', '..', 'opencode.json'));
assert.equal(Array.isArray(opencodeConfig.plugin), true);
assert.equal(opencodeConfig.plugin.includes('./plugins/pipeline-adaptation-plugin.js'), true);

assertOpenCodePluginFileRegistersStopGate()
  .then(() => console.log('stop gate pattern OK'))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
