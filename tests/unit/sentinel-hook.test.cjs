'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sentinelHook = require('../../src/opencode/sentinel-hook.cjs');
const plugin = require('../../src/opencode/pipeline-adaptation-plugin.cjs');
const opencodeIndex = require('../../src/opencode/index.cjs');
const { installGlobalArtifacts } = require('../../src/install/installer.cjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function state(overrides = {}) {
  return {
    schemaVersion: 'SENTINEL_STATE/v1',
    runId: 'run-sentinel-hook',
    currentPhase: 'phase_dispatch',
    checkpoints: {},
    blocked: false,
    stopRuleTriggered: false,
    lastValidEventId: null,
    updatedAt: '2026-06-24T03:00:00.000Z',
    pipeline_active: true,
    expected_next: 'executor-controller',
    ...overrides,
  };
}

function projectWithState(value) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w8-5-sentinel-'));
  const runDir = path.join(project, '.pipeline', 'docs', 'Pre-feature-action', value.runId || 'run-sentinel-hook');
  writeJson(path.join(runDir, 'sentinel-state.json'), value);
  writeJson(path.join(project, '.pipeline', 'active-run.json'), { pipeline_doc_path: runDir, run_id: value.runId || value.run_id });
  return { project, runDir };
}

function taskInput(project, agentName) {
  return { cwd: project, tool: 'task', args: { agentName } };
}

let fixture = projectWithState(state());
let output = {};
sentinelHook.handleToolExecuteBefore(taskInput(fixture.project, 'pipeline-implementer'), output);
assert.equal(output.error, undefined);

output = {};
sentinelHook.handleToolExecuteBefore(taskInput(fixture.project, 'pipeline-validator'), output);
assert.equal(output.error.code, 'SENTINEL_DIVERGENCE');
assert.match(output.error.reason, /executor-controller/);

fixture = projectWithState(state({ expected_next: ['pipeline-adversarial-security', 'pipeline-adversarial-quality'] }));
output = {};
sentinelHook.handleToolExecuteBefore(taskInput(fixture.project, 'pipeline-adversarial-quality'), output);
assert.equal(output.error, undefined);

output = {};
sentinelHook.handleToolExecuteBefore(taskInput(fixture.project, 'pipeline-validator'), output);
assert.equal(output.error.code, 'SENTINEL_DIVERGENCE');

const suffixBypass = projectWithState(state({ expected_next: 'final-validator' }));
output = {};
sentinelHook.handleToolExecuteBefore(taskInput(suffixBypass.project, 'pipeline-evil-final-validator'), output);
assert.equal(output.error.code, 'SENTINEL_DIVERGENCE');

const missingExpected = projectWithState(state({ expected_next: '' }));
output = {};
sentinelHook.handleToolExecuteBefore(taskInput(missingExpected.project, 'pipeline-implementer'), output);
assert.equal(output.error.code, 'SENTINEL_CHECKPOINT_MISSING_EXPECTED_NEXT');

const absentExpectedState = state();
delete absentExpectedState.expected_next;
const absentExpected = projectWithState(absentExpectedState);
output = {};
sentinelHook.handleToolExecuteBefore(taskInput(absentExpected.project, 'pipeline-implementer'), output);
assert.equal(output.error.code, 'SENTINEL_CHECKPOINT_MISSING_EXPECTED_NEXT');

const noStateProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w8-5-no-state-'));
output = {};
sentinelHook.handleToolExecuteBefore(taskInput(noStateProject, 'pipeline-run-orchestrator'), output);
assert.equal(output.error, undefined);

output = {};
sentinelHook.handleToolExecuteBefore(taskInput(noStateProject, 'pipeline-implementer'), output);
assert.equal(output.error.code, 'SENTINEL_STATE_MISSING');

const inactive = projectWithState(state({ pipeline_active: false }));
output = {};
sentinelHook.handleToolExecuteBefore(taskInput(inactive.project, 'pipeline-validator'), output);
assert.equal(output.error, undefined);

const staleFallback = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w8-5-stale-fallback-'));
const staleRunDir = path.join(staleFallback, '.pipeline', 'docs', 'Pre-feature-action', 'stale');
writeJson(path.join(staleRunDir, 'sentinel-state.json'), state({ runId: 'stale', pipeline_active: false }));
writeJson(path.join(staleFallback, '.pipeline', 'active-run.json'), { pipeline_doc_path: path.join(staleFallback, '.pipeline', 'docs', 'Pre-feature-action', 'missing') });
output = {};
sentinelHook.handleToolExecuteBefore(taskInput(staleFallback, 'pipeline-implementer'), output);
assert.equal(output.error.code, 'SENTINEL_STATE_CORRUPT');

const corrupt = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w8-5-corrupt-'));
const corruptRunDir = path.join(corrupt, '.pipeline', 'docs', 'Pre-feature-action', 'run-corrupt');
fs.mkdirSync(corruptRunDir, { recursive: true });
fs.writeFileSync(path.join(corruptRunDir, 'sentinel-state.json'), '{bad json');
writeJson(path.join(corrupt, '.pipeline', 'active-run.json'), { pipeline_doc_path: corruptRunDir });
output = {};
sentinelHook.handleToolExecuteBefore(taskInput(corrupt, 'pipeline-implementer'), output);
assert.equal(output.error.code, 'SENTINEL_STATE_CORRUPT');

const hooks = sentinelHook.createSentinelHooks({ projectDir: () => fixture.project });
output = {};
hooks['tool.execute.before'](taskInput(fixture.project, 'pipeline-validator'), output);
assert.equal(output.error.code, 'SENTINEL_DIVERGENCE');

const pluginProject = projectWithState(state({ expected_next: 'final-validator' }));
const pluginHooks = plugin.createPipelineAdaptationHooks({ directory: pluginProject.project });
output = {};
pluginHooks['tool.execute.before'](taskInput(pluginProject.project, 'pipeline-run-orchestrator'), output);
assert.equal(output.error.code, 'SENTINEL_DIVERGENCE');

const priorSpecificProject = projectWithState(state({ expected_next: 'pipeline-planner' }));
const priorSpecificHooks = plugin.createPipelineAdaptationHooks({ directory: priorSpecificProject.project });
output = {};
priorSpecificHooks['tool.execute.before'](taskInput(priorSpecificProject.project, 'pipeline-planner'), output);
assert.equal(output.error.code, 'PLAN_MODE_BYPASS');

assert.equal(typeof opencodeIndex.createSentinelHooks, 'function');

const repoRoot = path.resolve(__dirname, '..', '..');
const installTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w8-5-installed-plugin-'));
writeJson(path.join(installTarget, 'opencode.json'), { $schema: 'https://opencode.ai/config.json' });
const installResult = installGlobalArtifacts({
  sourceRoot: repoRoot,
  targetRoot: installTarget,
  packageVersion: 'w8-5-test',
  canonicalVersion: 'w8-5-test',
  setUserEnv: () => {},
});
assert.equal(installResult.ok, true);
assert.equal(fs.existsSync(path.join(installTarget, 'plugins', 'pipeline-adaptation-plugin.js')), true);

const installedProject = projectWithState(state({ expected_next: 'final-validator' }));
const installedSmoke = spawnSync(process.execPath, ['-e', `
  (async () => {
    const pluginFactory = require(${JSON.stringify(path.join(installTarget, 'plugins', 'pipeline-adaptation-plugin.js'))});
    const hooks = await pluginFactory({ directory: ${JSON.stringify(installedProject.project)} }, {});
    const output = {};
    hooks['tool.execute.before']({ cwd: ${JSON.stringify(installedProject.project)}, tool: 'task', args: { agentName: 'pipeline-run-orchestrator' } }, output);
    if (!output.error || output.error.code !== 'SENTINEL_DIVERGENCE') process.exit(2);
  })().catch(() => process.exit(1));
`], { encoding: 'utf8', stdio: 'pipe' });
assert.equal(installedSmoke.status, 0, installedSmoke.stderr || installedSmoke.stdout);

console.log('sentinel hook OK');
