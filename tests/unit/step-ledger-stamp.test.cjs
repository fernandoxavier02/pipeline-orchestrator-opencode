'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stamp = require('../../src/opencode/step-ledger-stamp.cjs');
const plugin = require('../../src/opencode/pipeline-adaptation-plugin.cjs');
const opencodeIndex = require('../../src/opencode/index.cjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sentinel(overrides = {}) {
  return {
    schemaVersion: 'SENTINEL_STATE/v1',
    runId: 'run-step-stamp',
    currentPhase: 'phase_1_to_2',
    checkpoints: {},
    blocked: false,
    stopRuleTriggered: false,
    lastValidEventId: null,
    updatedAt: '2026-06-22T14:00:00.000Z',
    pipeline_active: true,
    workflow_key: 'FULL',
    step_ledger: [],
    ...overrides,
  };
}

function projectWithState(state) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w2-3-step-stamp-'));
  const runDir = path.join(project, '.pipeline', 'docs', 'Pre-feature-action', 'run-step-stamp');
  const statePath = path.join(runDir, 'sentinel-state.json');
  writeJson(statePath, state);
  writeJson(path.join(project, '.pipeline', 'active-run.json'), { pipeline_doc_path: runDir });
  return { project, statePath };
}

assert.equal(stamp.hasUsableResult(null), false);
assert.equal(stamp.hasUsableResult('   '), false);
assert.equal(stamp.hasUsableResult('done'), true);
assert.equal(stamp.hasUsableResult({ status: 'completed', content: [] }), true);
assert.equal(stamp.hasUsableResult({ status: 'failed' }), false);
assert.equal(stamp.hasUsableResult({ is_error: true }), false);
assert.equal(stamp.hasUsableResult({ async_launched: true }), false);
assert.equal(stamp.hasUsableResult({}), false);
assert.equal(stamp.hasUsableResult({ ok: false }), false);
assert.equal(stamp.hasUsableResult({ success: false }), false);
assert.equal(stamp.hasUsableResult({ ok: true }), true);
assert.equal(stamp.hasUsableResult({ text: 'done' }), true);

// Acceptance: governed OpenCode task completion stamps its canonical step once.
let fixture = projectWithState(sentinel({ step_ledger: [] }));
let result = stamp.handleToolExecuteAfter(
  { cwd: fixture.project, tool: 'task', args: { agentName: 'pipeline-run-orchestrator' }, result: 'classified' },
  {},
  { nowIso: '2026-06-22T14:01:00.000Z' },
);
assert.equal(result.stamped, true);
let state = readJson(fixture.statePath);
assert.deepEqual(state.step_ledger, ['classify']);
assert.equal(state.updatedAt, '2026-06-22T14:01:00.000Z');

stamp.handleToolExecuteAfter(
  { cwd: fixture.project, tool: 'task', args: { agentName: 'pipeline-run-orchestrator' }, result: 'classified again' },
  {},
  { nowIso: '2026-06-22T14:02:00.000Z' },
);
state = readJson(fixture.statePath);
assert.deepEqual(state.step_ledger, ['classify']);

// Acceptance: no usable result means no step is stamped.
fixture = projectWithState(sentinel({ step_ledger: [] }));
result = stamp.handleToolExecuteAfter(
  { cwd: fixture.project, tool: 'task', args: { agentName: 'pipeline-information-gate' }, result: '' },
  {},
  { nowIso: '2026-06-22T14:03:00.000Z' },
);
assert.equal(result.stamped, false);
assert.deepEqual(readJson(fixture.statePath).step_ledger, []);

// Acceptance: object result shapes from OpenCode can stamp useful completions.
result = stamp.handleToolExecuteAfter(
  { cwd: fixture.project, tool: 'task', args: { agentName: 'pipeline-information-gate' }, result: { status: 'completed' } },
  {},
  { nowIso: '2026-06-22T14:04:00.000Z' },
);
assert.equal(result.stamped, true);
assert.deepEqual(readJson(fixture.statePath).step_ledger, ['info-gate']);

fixture = projectWithState(sentinel({ step_ledger: [] }));
result = stamp.handleToolExecuteAfter(
  { cwd: fixture.project, tool: 'task', args: { agentName: 'pipeline-run-orchestrator' } },
  { output: 'classified from OpenCode output field' },
  { nowIso: '2026-06-22T14:04:15.000Z' },
);
assert.equal(result.stamped, true);
assert.deepEqual(readJson(fixture.statePath).step_ledger, ['classify']);

// Acceptance: failed output cannot stamp using a stale or forged input result.
fixture = projectWithState(sentinel({ step_ledger: [] }));
result = stamp.handleToolExecuteAfter(
  { cwd: fixture.project, tool: 'task', args: { agentName: 'pipeline-information-gate' }, result: 'old result' },
  { error: { code: 'TASK_FAILED' } },
  { nowIso: '2026-06-22T14:04:30.000Z' },
);
assert.equal(result.stamped, false);
assert.deepEqual(readJson(fixture.statePath).step_ledger, []);

// Acceptance: inactive and non-authoritative states are not written.
fixture = projectWithState(sentinel({ pipeline_active: false, step_ledger: [] }));
result = stamp.handleToolExecuteAfter(
  { cwd: fixture.project, tool: 'task', args: { agentName: 'pipeline-run-orchestrator' }, result: 'done' },
  {},
  { nowIso: '2026-06-22T14:05:00.000Z' },
);
assert.equal(result.stamped, false);
assert.deepEqual(readJson(fixture.statePath).step_ledger, []);

const fallbackProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w2-3-step-stamp-fallback-'));
const fallbackRunDir = path.join(fallbackProject, '.pipeline', 'docs', 'Pre-feature-action', 'fallback-run');
const fallbackStatePath = path.join(fallbackRunDir, 'sentinel-state.json');
writeJson(fallbackStatePath, sentinel({ step_ledger: [] }));
result = stamp.handleToolExecuteAfter(
  { cwd: fallbackProject, tool: 'task', args: { agentName: 'pipeline-run-orchestrator' }, result: 'done' },
  {},
  { nowIso: '2026-06-22T14:06:00.000Z' },
);
assert.equal(result.stamped, false);
assert.deepEqual(readJson(fallbackStatePath).step_ledger, []);

// Acceptance: Claude Code-only subagent_type is ignored in OpenCode.
fixture = projectWithState(sentinel({ step_ledger: [] }));
result = stamp.handleToolExecuteAfter(
  { cwd: fixture.project, tool: 'task', args: { subagent_type: 'pipeline:task-orchestrator' }, result: 'done' },
  {},
  { nowIso: '2026-06-22T14:07:00.000Z' },
);
assert.equal(result.stamped, false);
assert.deepEqual(readJson(fixture.statePath).step_ledger, []);

// Acceptance: local adversarial reviewers do not individually complete the canonical adversarial step.
result = stamp.handleToolExecuteAfter(
  { cwd: fixture.project, tool: 'task', args: { agentName: 'pipeline-adversarial-security' }, result: 'reviewed' },
  {},
  { nowIso: '2026-06-22T14:07:30.000Z' },
);
assert.equal(result.stamped, false);
assert.deepEqual(readJson(fixture.statePath).step_ledger, []);

// Acceptance: deterministic counters are bumped for known canonical counter agents.
fixture = projectWithState(sentinel({ step_ledger: [] }));
stamp.handleToolExecuteAfter(
  { cwd: fixture.project, tool: 'task', args: { agentName: 'checkpoint-validator' }, result: 'checked' },
  {},
  { nowIso: '2026-06-22T14:08:00.000Z' },
);
state = readJson(fixture.statePath);
assert.equal(state.batch_checkpoints_done, 1);

stamp.handleToolExecuteAfter(
  { cwd: fixture.project, tool: 'task', args: { agentName: 'review-orchestrator' }, result: 'reviewed' },
  {},
  { nowIso: '2026-06-22T14:09:00.000Z' },
);
state = readJson(fixture.statePath);
assert.equal(state.batch_reviews_done, 1);
assert.equal(state.step_ledger.includes('adversarial'), true);

fixture = projectWithState(sentinel({ step_ledger: [], fix_loop_attempts: 0 }));
result = stamp.handleToolExecuteAfter(
  { cwd: fixture.project, tool: 'task', args: { agentName: 'executor-fix' }, result: { status: 'failed' } },
  {},
  { nowIso: '2026-06-22T14:09:30.000Z' },
);
state = readJson(fixture.statePath);
assert.equal(result.changed, true);
assert.equal(result.stamped, false);
assert.equal(state.fix_loop_attempts, 1);

// Acceptance: plugin factory and index expose the after hook.
fixture = projectWithState(sentinel({ step_ledger: [] }));
const hooks = plugin.createPipelineAdaptationHooks({ directory: fixture.project }, { nowIso: '2026-06-22T14:10:00.000Z' });
assert.equal(typeof hooks['tool.execute.after'], 'function');
hooks['tool.execute.after']({ tool: 'task', args: { agentName: 'pipeline-run-orchestrator' }, result: 'done' }, {});
assert.deepEqual(readJson(fixture.statePath).step_ledger, ['classify']);
assert.equal(typeof opencodeIndex.createStepLedgerStampHooks, 'function');

console.log('step ledger stamp OK');
