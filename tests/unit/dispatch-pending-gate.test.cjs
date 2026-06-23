'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeArmPending } = require('../../src/lib/pipeline-arm.cjs');
const gate = require('../../src/opencode/dispatch-pending-gate.cjs');
const plugin = require('../../src/opencode/pipeline-adaptation-plugin.cjs');
const opencodeIndex = require('../../src/opencode/index.cjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function appendJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

function sentinel(overrides = {}) {
  return {
    schemaVersion: 'SENTINEL_STATE/v1',
    runId: 'run-dispatch-pending',
    currentPhase: 'phase_1_to_2',
    checkpoints: {},
    blocked: false,
    stopRuleTriggered: false,
    lastValidEventId: null,
    updatedAt: new Date().toISOString(),
    pipeline_active: true,
    workflow_key: 'FULL',
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
    pending_blocks: [],
    ...overrides,
  };
}

function pending(overrides = {}) {
  return {
    block_type: 'DISPATCH_REQUEST',
    dispatch_id: 'pipeline-implementer',
    emitted_at: new Date().toISOString(),
    ...overrides,
  };
}

function projectWithState(state) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w4-1-dispatch-pending-'));
  const runDir = path.join(project, '.pipeline', 'docs', 'Pre-feature-action', state.runId || 'run-dispatch-pending');
  writeJson(path.join(runDir, 'sentinel-state.json'), state);
  writeJson(path.join(project, '.pipeline', 'active-run.json'), { pipeline_doc_path: runDir });
  return { project, runDir };
}

let output = {};
gate.handleToolExecuteBefore({ cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'po-w4-1-no-state-')), tool: 'bash', args: { command: 'npm test' } }, output);
assert.equal(output.error, undefined);

const pendingProject = projectWithState(sentinel({ pending_blocks: [pending()] }));

// Acceptance: parent work tools are blocked while a live dispatch handshake is pending.
output = {};
gate.handleToolExecuteBefore({ cwd: pendingProject.project, tool: 'bash', args: { command: 'npm test' } }, output);
assert.equal(output.error.code, 'INLINE_WORK_BLOCKED');
assert.equal(output.error.pendingId, 'pipeline-implementer');

output = {};
gate.handleToolExecuteBefore({ cwd: pendingProject.project, tool: 'read', args: { filePath: path.join(pendingProject.project, 'src', 'x.js') } }, output);
assert.equal(output.error.code, 'INLINE_WORK_BLOCKED');

// Acceptance: pipeline artifacts and control tools are allowed.
output = {};
gate.handleToolExecuteBefore({ cwd: pendingProject.project, tool: 'read', args: { filePath: path.join(pendingProject.project, '.pipeline', 'notes.md') } }, output);
assert.equal(output.error, undefined);

output = {};
gate.handleToolExecuteBefore({ cwd: pendingProject.project, tool: 'question', args: {} }, output);
assert.equal(output.error, undefined);

output = {};
gate.handleToolExecuteBefore({ cwd: pendingProject.project, tool: 'todowrite', args: {} }, output);
assert.equal(output.error, undefined);

// Acceptance: only the target subagent or explicit result payload resolves the dispatch.
output = {};
gate.handleToolExecuteBefore({ cwd: pendingProject.project, tool: 'task', args: { agentName: 'pipeline-implementer', prompt: 'do the delegated work' } }, output);
assert.equal(output.error, undefined);

output = {};
gate.handleToolExecuteBefore({ cwd: pendingProject.project, tool: 'task', args: { agentName: 'pipeline-validator', prompt: 'wrong agent' } }, output);
assert.equal(output.error.code, 'INLINE_WORK_BLOCKED');

output = {};
gate.handleToolExecuteBefore({ cwd: pendingProject.project, tool: 'task', args: { agentName: 'pipeline-implementer-extra', prompt: 'looks close' } }, output);
assert.equal(output.error.code, 'INLINE_WORK_BLOCKED');

output = {};
gate.handleToolExecuteBefore({ cwd: pendingProject.project, tool: 'task', args: { agentName: 'pipeline-validator', prompt: 'DISPATCH_RESULTS: done' } }, output);
assert.equal(output.error.code, 'INLINE_WORK_BLOCKED');

output = {};
gate.handleToolExecuteBefore({ cwd: pendingProject.project, tool: 'task', args: { agentName: 'pipeline-validator', prompt: 'DISPATCH_RESULTS pipeline-implementer-extra: done' } }, output);
assert.equal(output.error.code, 'INLINE_WORK_BLOCKED');

output = {};
gate.handleToolExecuteBefore({ cwd: pendingProject.project, tool: 'task', args: { agentName: 'pipeline-validator', prompt: 'DISPATCH_RESULTS pipeline-implementer: done' } }, output);
assert.equal(output.error, undefined);

output = { args: { agentName: 'pipeline-implementer', prompt: 'mutated target' } };
gate.handleToolExecuteBefore({ cwd: pendingProject.project, tool: 'task', args: { agentName: 'pipeline-validator', prompt: 'original wrong target' } }, output);
assert.equal(output.error, undefined);

output = {};
gate.handleToolExecuteBefore({ cwd: pendingProject.project, tool: 'bash', args: { command: 'npm test', path: path.join(pendingProject.project, '.pipeline', 'notes.md') } }, output);
assert.equal(output.error.code, 'INLINE_WORK_BLOCKED');

// Acceptance: pending blocks expire and inactive runs do not block.
const expiredProject = projectWithState(sentinel({ pending_blocks: [pending({ emitted_at: new Date(Date.now() - 120_000).toISOString() })] }));
output = {};
gate.handleToolExecuteBefore({ cwd: expiredProject.project, tool: 'bash', args: { command: 'npm test' } }, output, { handshakeTimeoutMs: 60_000 });
assert.equal(output.error, undefined);

const inactiveProject = projectWithState(sentinel({ pipeline_active: false, pending_blocks: [pending()] }));
output = {};
gate.handleToolExecuteBefore({ cwd: inactiveProject.project, tool: 'bash', args: { command: 'npm test' } }, output);
assert.equal(output.error, undefined);

const gatePendingProject = projectWithState(sentinel({ pending_blocks: [pending({ block_type: 'GATE_REQUEST', gate_id: 'gate-1', dispatch_id: undefined })] }));
output = {};
gate.handleToolExecuteBefore({ cwd: gatePendingProject.project, tool: 'bash', args: { command: 'npm test' } }, output);
assert.equal(output.error.code, 'INLINE_WORK_BLOCKED');
output = {};
gate.handleToolExecuteBefore({ cwd: gatePendingProject.project, tool: 'question', args: {} }, output);
assert.equal(output.error, undefined);

const planPendingProject = projectWithState(sentinel({ pending_blocks: [pending({ block_type: 'PLAN_MODE_REQUEST', plan_id: 'plan-1', dispatch_id: undefined })] }));
output = {};
gate.handleToolExecuteBefore({ cwd: planPendingProject.project, tool: 'bash', args: { command: 'npm test' } }, output);
assert.equal(output.error.code, 'INLINE_WORK_BLOCKED');
output = {};
gate.handleToolExecuteBefore({ cwd: planPendingProject.project, tool: 'enterplanmode', args: {} }, output);
assert.equal(output.error, undefined);

const execWindowProject = projectWithState(sentinel({ pending_blocks: [pending()] }));
const sessionId = 'session-1';
const sessionsDir = path.join(execWindowProject.project, '.pipeline', 'sessions');
writeJson(path.join(sessionsDir, 'active.lock'), { session_id: sessionId, expires_at: Date.now() + 60_000, status: 'active', created_at: Date.now(), last_seen_at: Date.now() });
writeJson(path.join(sessionsDir, 'active.exec-window'), { session_id: sessionId, ttl_minutes: 5 });
const openedAt = fs.statSync(path.join(sessionsDir, 'active.exec-window')).mtimeMs;
appendJsonl(path.join(execWindowProject.runDir, 'gate-decisions.jsonl'), [{ gate: 'EXEC_WINDOW_OPEN', session_id: sessionId, timestamp: openedAt }]);
output = {};
gate.handleToolExecuteBefore({ cwd: execWindowProject.project, tool: 'bash', args: { command: 'npm test' } }, output);
assert.equal(output.error, undefined);

// Acceptance: warn mode records warning instead of blocking.
process.env.PIPELINE_DISPATCH_INLINE_ENFORCEMENT = 'warn';
try {
  output = {};
  gate.handleToolExecuteBefore({ cwd: pendingProject.project, tool: 'bash', args: { command: 'npm test' } }, output);
  assert.equal(output.error, undefined);
  assert.equal(output.warning.code, 'INLINE_WORK_BLOCKED');
} finally {
  delete process.env.PIPELINE_DISPATCH_INLINE_ENFORCEMENT;
}

// Acceptance: corrupt authoritative state fails closed for work tools but permits control tools.
const corruptProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w4-1-dispatch-corrupt-'));
const corruptRunDir = path.join(corruptProject, '.pipeline', 'docs', 'Pre-feature-action', 'run-corrupt');
fs.mkdirSync(corruptRunDir, { recursive: true });
fs.writeFileSync(path.join(corruptRunDir, 'sentinel-state.json'), '{bad json');
writeJson(path.join(corruptProject, '.pipeline', 'active-run.json'), { pipeline_doc_path: corruptRunDir });

output = {};
gate.handleToolExecuteBefore({ cwd: corruptProject, tool: 'question', args: {} }, output);
assert.equal(output.error, undefined);

output = {};
gate.handleToolExecuteBefore({ cwd: corruptProject, tool: 'bash', args: { command: 'npm test' } }, output);
assert.equal(output.error.code, 'DISPATCH_PENDING_STATE_CORRUPT');

output = {};
gate.handleToolExecuteBefore({ cwd: corruptProject, tool: 'task', args: { agentName: 'pipeline-validator', prompt: 'GATE_RESPONSES: ok' } }, output);
assert.equal(output.error.code, 'DISPATCH_PENDING_STATE_CORRUPT');

// Acceptance: hook factory, plugin composition, and index expose W4.1.
const hooks = gate.createDispatchPendingGateHooks({ projectDir: () => pendingProject.project });
output = {};
hooks['tool.execute.before']({ tool: 'bash', args: { command: 'npm test' } }, output);
assert.equal(output.error.code, 'INLINE_WORK_BLOCKED');

const pluginHooks = plugin.createPipelineAdaptationHooks({ directory: pendingProject.project });
output = {};
pluginHooks['tool.execute.before']({ tool: 'bash', args: { command: 'npm test' } }, output);
assert.equal(output.error.code, 'INLINE_WORK_BLOCKED');

const armProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w4-1-arm-composition-'));
writeArmPending(armProject, '/pipeline feature criar tela', new Date().toISOString());
const composedHooks = plugin.createPipelineAdaptationHooks({ directory: armProject });
output = {};
composedHooks['tool.execute.before']({ tool: 'edit', args: { filePath: path.join(armProject, 'src', 'x.js') } }, output);
assert.equal(output.error.code, 'PIPELINE_NOT_ARMED');

assert.equal(typeof opencodeIndex.createDispatchPendingGateHooks, 'function');

console.log('dispatch pending gate OK');
