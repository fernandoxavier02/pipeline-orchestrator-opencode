'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stopHook = require('../../src/opencode/stop-hook.cjs');
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
    runId: 'run-stop-hook',
    currentPhase: 'phase_stop_hook',
    checkpoints: {},
    blocked: false,
    stopRuleTriggered: false,
    lastValidEventId: null,
    created_at: '2026-06-24T00:00:00.000Z',
    updatedAt: '2026-06-24T00:01:00.000Z',
    pipeline_active: true,
    workflow_key: 'FULL',
    task_type: 'feature',
    complexity: 'medium',
    ...overrides,
  };
}

function projectWithRun(state, gateRows = []) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w7-2-stop-'));
  const runDir = path.join(project, '.pipeline', 'docs', 'Pre-feature-action', state.runId || state.run_id || 'run-stop-hook');
  const statePath = path.join(runDir, 'sentinel-state.json');
  writeJson(statePath, state);
  writeJson(path.join(runDir, 'session.json'), { started_at: '2026-06-24T00:00:00.000Z', status: 'interrupted' });
  if (gateRows.length > 0) {
    fs.writeFileSync(path.join(runDir, 'gate-decisions.jsonl'), gateRows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  }
  writeJson(path.join(project, '.pipeline', 'active-run.json'), { pipeline_doc_path: runDir, run_id: state.runId || state.run_id, updated_at: '2026-06-24T00:01:00.000Z' });
  return { project, runDir, statePath };
}

function idleInput(project) {
  return { cwd: project, event: { type: 'session.idle', properties: { reason: 'user_stop' } } };
}

const noRun = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w7-2-no-run-'));
stopHook.handleStop(idleInput(noRun), {}, { nowIso: '2026-06-24T00:10:00.000Z' });
assert.equal(fs.existsSync(path.join(noRun, '.pipeline', 'run-log.jsonl')), false);

const governed = projectWithRun(sentinel(), [
  { gate: 'ACCEPTANCE', decision: 'CONFIRMED' },
  { gate: 'GREEN', decision: 'CONFIRMED' },
]);
stopHook.handleStop(idleInput(governed.project), {}, { nowIso: '2026-06-24T00:10:00.000Z' });

let runLog = readJsonl(path.join(governed.project, '.pipeline', 'run-log.jsonl'));
assert.equal(runLog.length, 1);
assert.equal(runLog[0].run_id, 'run-stop-hook');
assert.equal(runLog[0].type, 'feature');
assert.equal(runLog[0].complexity, 'medium');
assert.equal(runLog[0].total_gates_triggered, 2);
assert.equal(runLog[0].final_decision, 'interrupted');
assert.equal(runLog[0].pipeline_doc_path, '.pipeline/docs/Pre-feature-action/run-stop-hook/');

const report = readJson(path.join(governed.runDir, 'fidelity-report.json'));
assert.equal(report.run_id, 'run-stop-hook');
assert.equal(report.mandatory_triggered, 2);
assert.equal(typeof report.fidelity_score, 'number');

stopHook.handleStop(idleInput(governed.project), {}, { nowIso: '2026-06-24T00:11:00.000Z' });
runLog = readJsonl(path.join(governed.project, '.pipeline', 'run-log.jsonl'));
assert.equal(runLog.length, 1);

fs.appendFileSync(path.join(governed.runDir, 'gate-decisions.jsonl'), JSON.stringify({ gate: 'FINAL_VERDICT', decision: 'CONFIRMED' }) + '\n');
stopHook.handleStop(idleInput(governed.project), {}, { nowIso: '2026-06-24T00:12:00.000Z' });
runLog = readJsonl(path.join(governed.project, '.pipeline', 'run-log.jsonl'));
assert.equal(runLog.length, 2);
assert.equal(runLog[1].total_gates_triggered, 3);

const completed = projectWithRun(sentinel({ runId: 'run-stop-hook-complete', terminal_state: 'completed', status: 'completed', pipeline_active: false }));
stopHook.handleStop(idleInput(completed.project), {}, { nowIso: '2026-06-24T00:13:00.000Z' });
assert.equal(readJsonl(path.join(completed.project, '.pipeline', 'run-log.jsonl')).length, 1);
const noGateReport = readJson(path.join(completed.runDir, 'fidelity-report.json'));
assert.equal(noGateReport.run_id, 'run-stop-hook-complete');
assert.equal(noGateReport.mandatory_triggered, 0);

const richer = projectWithRun(sentinel({ runId: 'run-stop-hook-rich' }), [
  { gate: 'ACCEPTANCE', decision: 'CONFIRMED' },
]);
writeJson(path.join(richer.runDir, 'fidelity-report.json'), {
  schemaVersion: 'PIPELINE_FIDELITY_REPORT/v1',
  run_id: 'run-stop-hook-rich',
  generated_by: 'existing-rich-reporter',
  mandatory_triggered: 1,
  mandatory_expected: 5,
  fidelity_score: 0.2,
  rich_detail: 'preserve-me',
});
stopHook.handleStop(idleInput(richer.project), {}, { nowIso: '2026-06-24T00:13:30.000Z' });
const preserved = readJson(path.join(richer.runDir, 'fidelity-report.json'));
assert.equal(preserved.generated_by, 'existing-rich-reporter');
assert.equal(preserved.rich_detail, 'preserve-me');

const hooks = stopHook.createStopHookHooks({ projectDir: () => governed.project, nowIso: '2026-06-24T00:14:00.000Z' });
assert.equal(typeof hooks.event, 'function');
assert.equal(typeof hooks['session.idle'], 'function');

const pluginProject = projectWithRun(sentinel({ runId: 'run-stop-hook-plugin' }));
const pluginHooks = plugin.createPipelineAdaptationHooks({ directory: pluginProject.project }, { nowIso: '2026-06-24T00:15:00.000Z' });
pluginHooks.event(idleInput(pluginProject.project), {});
assert.equal(readJsonl(path.join(pluginProject.project, '.pipeline', 'run-log.jsonl'))[0].run_id, 'run-stop-hook-plugin');

assert.equal(typeof opencodeIndex.createStopHookHooks, 'function');

console.log('stop hook OK');
