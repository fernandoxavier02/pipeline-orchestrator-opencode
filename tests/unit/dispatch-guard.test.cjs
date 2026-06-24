'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const guard = require('../../src/opencode/dispatch-guard.cjs');
const plugin = require('../../src/opencode/pipeline-adaptation-plugin.cjs');
const opencodeIndex = require('../../src/opencode/index.cjs');
const { installGlobalArtifacts } = require('../../src/install/installer.cjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function appendJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

function withEnv(name, value, fn) {
  const previous = process.env[name];
  if (value == null) delete process.env[name]; else process.env[name] = value;
  try { return fn(); } finally {
    if (previous == null) delete process.env[name]; else process.env[name] = previous;
  }
}

function sentinel(overrides = {}) {
  return {
    schemaVersion: 'SENTINEL_STATE/v1',
    runId: 'run-dispatch-guard',
    currentPhase: 'phase_dispatch',
    checkpoints: {},
    blocked: false,
    stopRuleTriggered: false,
    lastValidEventId: null,
    updatedAt: '2026-06-24T00:01:00.000Z',
    pipeline_active: true,
    workflow_key: 'FULL',
    task_type: 'feature',
    complexity: 'medium',
    orchestrator_decision: { type: 'Feature', complexity: 'MEDIA' },
    ...overrides,
  };
}

function gateReadySentinel(overrides = {}) {
  return sentinel({
    currentPhase: 'phase_1_to_2',
    step_ledger: ['classify', 'info-gate', 'plan', 'tdd', 'execute', 'adversarial', 'sanity', 'final'],
    batch_checkpoints_done: 1,
    batch_reviews_done: 1,
    last_checkpoint_verdict: 'pass',
    consecutive_checkpoint_failures: 0,
    ssot_status: 'ok',
    info_gate: 'open',
    plan_status: 'approved',
    final_review_verdict: 'clear',
    final_decision: 'GO',
    ...overrides,
  });
}

function projectWithState(state) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w8-1-dispatch-'));
  const runDir = path.join(project, '.pipeline', 'docs', 'Pre-feature-action', state.runId || state.run_id || 'run-dispatch-guard');
  writeJson(path.join(runDir, 'sentinel-state.json'), state);
  writeJson(path.join(project, '.pipeline', 'active-run.json'), { pipeline_doc_path: runDir, run_id: state.runId || state.run_id, updated_at: '2026-06-24T00:01:00.000Z' });
  return { project, runDir };
}

function taskInput(project, subagentType, prompt = 'work') {
  return { cwd: project, tool: 'task', args: { subagent_type: subagentType, prompt } };
}

const planRun = projectWithState(sentinel({ runId: 'run-plan-mode' }));
let output = {};
guard.handleToolExecuteBefore(taskInput(planRun.project, 'pipeline-orchestrator:quality:plan-architect'), output, { nowIso: '2026-06-24T00:10:00.000Z' });
assert.equal(output.error.code, 'PLAN_MODE_BYPASS');
let events = readJsonl(path.join(planRun.runDir, 'protocol-events.jsonl'));
assert.equal(events.at(-1).event, 'PLAN_MODE_BYPASS');

output = {};
guard.handleToolExecuteBefore(taskInput(planRun.project, 'pipeline-orchestrator:quality:plan-architect'), output, { nowIso: '2026-06-24T00:11:00.000Z' });
assert.equal(output.error.code, 'PLAN_MODE_BYPASS');
events = readJsonl(path.join(planRun.runDir, 'protocol-events.jsonl'));
assert.equal(events.at(-1).event, 'PLAN_MODE_BYPASS');

output = {};
guard.handleToolExecuteBefore(taskInput(planRun.project, 'pipeline-orchestrator:quality:plan-architect', 'PLAN_MODE_RESULTS\napproved plan'), output, { nowIso: '2026-06-24T00:12:00.000Z' });
assert.equal(output.error, undefined);

const brainstormRun = projectWithState(sentinel({ runId: 'run-brainstorm-missing' }));
output = {};
guard.handleToolExecuteBefore(taskInput(brainstormRun.project, 'pipeline-orchestrator:executor:executor-controller', 'PLAN_MODE_RESULTS\napproved'), output, { nowIso: '2026-06-24T00:13:00.000Z' });
assert.equal(output.error.code, 'BRAINSTORM_BYPASS');
events = readJsonl(path.join(brainstormRun.runDir, 'protocol-events.jsonl'));
assert.equal(events.at(-1).event, 'BRAINSTORM_BYPASS');

const brainstormDone = projectWithState(sentinel({
  runId: 'run-brainstorm-done',
  step_1_7: { decision: 'dispatch-brainstorm' },
}));
output = {};
guard.handleToolExecuteBefore(taskInput(brainstormDone.project, 'pipeline-orchestrator:executor:executor-controller', 'PLAN_MODE_RESULTS\napproved'), output, { nowIso: '2026-06-24T00:14:00.000Z' });
assert.equal(output.error, undefined);

const simpleRun = projectWithState(sentinel({
  runId: 'run-simple-exempt',
  orchestrator_decision: { type: 'Feature', complexity: 'SIMPLES' },
}));
output = {};
guard.handleToolExecuteBefore(taskInput(simpleRun.project, 'pipeline-orchestrator:executor:executor-controller', 'PLAN_MODE_RESULTS\napproved'), output, { nowIso: '2026-06-24T00:15:00.000Z' });
assert.equal(output.error, undefined);

const hooks = guard.createDispatchGuardHooks({ projectDir: () => planRun.project, nowIso: '2026-06-24T00:16:00.000Z' });
assert.equal(typeof hooks['tool.execute.before'], 'function');

const pluginProject = projectWithState(sentinel({ runId: 'run-dispatch-plugin' }));
const pluginHooks = plugin.createPipelineAdaptationHooks({ directory: pluginProject.project }, { nowIso: '2026-06-24T00:17:00.000Z' });
output = {};
pluginHooks['tool.execute.before'](taskInput(pluginProject.project, 'pipeline-orchestrator:quality:plan-architect'), output);
assert.equal(output.error.code, 'PLAN_MODE_BYPASS');
assert.equal(readJsonl(path.join(pluginProject.runDir, 'protocol-events.jsonl')).at(-1).event, 'PLAN_MODE_BYPASS');

assert.equal(typeof opencodeIndex.createDispatchGuardHooks, 'function');

const warningRun = projectWithState(sentinel({ runId: 'run-warning-mode' }));
withEnv('PIPELINE_PLAN_MODE_ENFORCEMENT', 'warn', () => {
  output = {};
  guard.handleToolExecuteBefore(taskInput(warningRun.project, 'pipeline-orchestrator:quality:pre-tester'), output, { nowIso: '2026-06-24T00:18:00.000Z' });
  assert.equal(output.error, undefined);
  assert.equal(output.warning.code, 'PLAN_MODE_BYPASS');
});

const combinedRun = projectWithState(sentinel({ runId: 'run-warning-plus-brainstorm' }));
withEnv('PIPELINE_PLAN_MODE_ENFORCEMENT', 'warn', () => {
  output = {};
  guard.handleToolExecuteBefore(taskInput(combinedRun.project, 'pipeline-implementer'), output, { nowIso: '2026-06-24T00:18:30.000Z' });
  assert.equal(output.error.code, 'BRAINSTORM_BYPASS');
});

const corruptProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w8-1-corrupt-'));
output = {};
guard.handleToolExecuteBefore(taskInput(corruptProject, 'pipeline-orchestrator:quality:pre-tester'), output, {
  nowIso: '2026-06-24T00:19:00.000Z',
  discoverStatePath: () => ({ statePath: path.join(corruptProject, '.pipeline', 'docs', 'Pre-feature-action', 'bad', 'sentinel-state.json') }),
  findActiveSentinelState: () => guard.CORRUPT_SENTINEL,
});
assert.equal(output.error.code, 'DISPATCH_GUARD_STATE_CORRUPT');

const inactiveRun = projectWithState(sentinel({ runId: 'run-inactive', pipeline_active: false }));
output = {};
guard.handleToolExecuteBefore(taskInput(inactiveRun.project, 'pipeline-orchestrator:quality:pre-tester'), output, { nowIso: '2026-06-24T00:20:00.000Z' });
assert.equal(output.error, undefined);

const variantRun = projectWithState(sentinel({ runId: 'run-input-variants' }));
output = {};
guard.handleToolExecuteBefore({ cwd: variantRun.project, toolName: 'agent', tool_input: { agentName: 'pipeline-orchestrator:quality:pre-tester', prompt: 'no plan' } }, output, { nowIso: '2026-06-24T00:21:00.000Z' });
assert.equal(output.error.code, 'PLAN_MODE_BYPASS');

const mutationRun = projectWithState(sentinel({ runId: 'run-output-mutation' }));
output = { args: { subagent_type: 'pipeline-orchestrator:quality:plan-architect' } };
guard.handleToolExecuteBefore(taskInput(mutationRun.project, 'pipeline-orchestrator:executor:executor-controller', 'PLAN_MODE_RESULTS\napproved'), output, { nowIso: '2026-06-24T00:22:00.000Z' });
assert.equal(output.error.code, 'DISPATCH_TARGET_MUTATED');

const injectionRun = projectWithState(sentinel({ runId: 'run-output-injection' }));
output = { args: { subagent_type: 'pipeline-orchestrator:quality:plan-architect' } };
guard.handleToolExecuteBefore({ cwd: injectionRun.project, tool: 'task', args: { prompt: 'PLAN_MODE_RESULTS\napproved' } }, output, { nowIso: '2026-06-24T00:22:30.000Z' });
assert.equal(output.error.code, 'DISPATCH_TARGET_MUTATED');

for (const realAgent of ['pipeline-planner', 'pipeline-pre-tester']) {
  const realRun = projectWithState(sentinel({ runId: `run-real-${realAgent}` }));
  output = {};
  guard.handleToolExecuteBefore(taskInput(realRun.project, realAgent), output, { nowIso: '2026-06-24T00:22:40.000Z' });
  assert.equal(output.error.code, 'PLAN_MODE_BYPASS');
}

const realImplementerRun = projectWithState(sentinel({ runId: 'run-real-implementer' }));
output = {};
guard.handleToolExecuteBefore(taskInput(realImplementerRun.project, 'pipeline-implementer', 'PLAN_MODE_RESULTS\napproved'), output, { nowIso: '2026-06-24T00:22:50.000Z' });
assert.equal(output.error.code, 'BRAINSTORM_BYPASS');

const staleRun = projectWithState(sentinel({ runId: 'run-stale-marker' }));
guard.writeMarker(staleRun.runDir, 'plan-mode-pending', 'pre-tester', sentinel({ runId: 'run-stale-marker' }), { projectDir: staleRun.project, nowIso: '2026-06-22T00:00:00.000Z' });
assert.equal(
  guard.readMarker(staleRun.runDir, 'plan-mode-pending', 'pre-tester', sentinel({ runId: 'run-stale-marker' }), { projectDir: staleRun.project, nowIso: '2026-06-24T00:23:00.000Z' }),
  null,
);

const outsideRun = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w8-1-outside-'));
assert.equal(guard.writeMarker(outsideRun, 'plan-mode-pending', 'pre-tester', sentinel(), { projectDir: staleRun.project, nowIso: '2026-06-24T00:24:00.000Z' }), false);

const composedConflict = projectWithState(gateReadySentinel({ runId: 'run-composed-conflict' }));
appendJsonl(path.join(composedConflict.runDir, 'gate-decisions.jsonl'), []);
const composedHooks = plugin.createPipelineAdaptationHooks({ directory: composedConflict.project }, { nowIso: '2026-06-24T00:25:00.000Z' });
output = {};
composedHooks['tool.execute.before']({ cwd: composedConflict.project, tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
assert.equal(output.error.code, 'GATE_LOG_MISSING');

const repoRoot = path.resolve(__dirname, '..', '..');
const installTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w8-1-real-install-'));
writeJson(path.join(installTarget, 'opencode.json'), { $schema: 'https://opencode.ai/config.json' });
const installResult = installGlobalArtifacts({
  sourceRoot: repoRoot,
  targetRoot: installTarget,
  packageVersion: 'w8-1-test',
  canonicalVersion: 'w8-1-test',
  setUserEnv: () => {},
});
assert.equal(installResult.ok, true);

const installedProject = projectWithState(sentinel({ runId: 'run-real-installed-plugin' }));
(async () => {
  const installedHooks = await require(path.join(installTarget, 'plugins', 'pipeline-adaptation-plugin.js'))({ directory: installedProject.project }, { nowIso: '2026-06-24T00:26:00.000Z' });
  output = {};
  installedHooks['tool.execute.before']({ cwd: installedProject.project, tool: 'task', args: { agentName: 'pipeline-planner' } }, output);
  assert.equal(output.error.code, 'PLAN_MODE_BYPASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

console.log('dispatch guard OK');
