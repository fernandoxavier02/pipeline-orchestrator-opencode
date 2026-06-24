'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const guard = require('../../src/opencode/edit-guard-hook.cjs');
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
    runId: 'run-edit-guard',
    currentPhase: 'phase_execute',
    checkpoints: {},
    blocked: false,
    stopRuleTriggered: false,
    lastValidEventId: null,
    updatedAt: '2026-06-24T01:00:00.000Z',
    pipeline_active: true,
    workflow_key: 'FULL',
    ...overrides,
  };
}

function projectWithState(state) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w8-2-edit-'));
  const runDir = path.join(project, '.pipeline', 'docs', 'Pre-feature-action', state.runId || 'run-edit-guard');
  writeJson(path.join(runDir, 'sentinel-state.json'), state);
  writeJson(path.join(project, '.pipeline', 'active-run.json'), { pipeline_doc_path: runDir, run_id: state.runId || state.run_id });
  return { project, runDir };
}

function editInput(project, filePath) {
  return { cwd: project, tool: 'edit', args: { filePath, oldString: 'a', newString: 'b' } };
}

function shellInput(project, command) {
  return { cwd: project, tool: 'bash', args: { command } };
}

const active = projectWithState(sentinel());
let output = {};
guard.handleToolExecuteBefore(editInput(active.project, path.join(active.project, 'src', 'app.js')), output);
assert.equal(output.error.code, 'EDIT_GUARD_EXEC_WINDOW_REQUIRED');

const planRequired = projectWithState(sentinel({ planGate: { required: true, approved: false } }));
output = {};
guard.handleToolExecuteBefore(editInput(planRequired.project, path.join(planRequired.project, 'src', 'app.js')), output);
assert.equal(output.error.code, 'PLAN_GATE_ACTIVE');

const planRequiredShell = projectWithState(sentinel({ planGate: { required: true, approved: false } }));
output = {};
guard.handleToolExecuteBefore(shellInput(planRequiredShell.project, 'touch src/app.js'), output);
assert.equal(output.error.code, 'PLAN_GATE_TERMINAL_BLOCKED');

const planApproved = projectWithState(sentinel({ planGate: { required: true, approved: true } }));
output = {};
guard.handleToolExecuteBefore(editInput(planApproved.project, path.join(planApproved.project, 'src', 'app.js')), output);
assert.equal(output.error.code, 'EDIT_GUARD_EXEC_WINDOW_REQUIRED');

output = {};
guard.handleToolExecuteBefore(editInput(active.project, path.join(active.runDir, 'evidence.md')), output);
assert.equal(output.error, undefined);

output = {};
guard.handleToolExecuteBefore(shellInput(active.project, 'echo hello'), output);
assert.equal(output.error, undefined);

output = {};
guard.handleToolExecuteBefore(shellInput(active.project, 'echo hello > src/app.js'), output);
assert.equal(output.error.code, 'EDIT_GUARD_EXEC_WINDOW_REQUIRED');

const pending = projectWithState(sentinel({
  pending_blocks: [{ block_type: 'DISPATCH_REQUEST', dispatch_id: 'dispatch-1', emitted_at: Date.now() }],
}));
output = {};
guard.handleToolExecuteBefore(editInput(pending.project, path.join(pending.project, 'src', 'app.js')), output);
assert.equal(output.error.code, 'INLINE_WORK_BLOCKED');

output = {};
guard.handleToolExecuteBefore(editInput(pending.project, path.join(pending.runDir, 'evidence.md')), output);
assert.equal(output.error.code, 'INLINE_WORK_BLOCKED');

const corrupt = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w8-2-corrupt-'));
const corruptRunDir = path.join(corrupt, '.pipeline', 'docs', 'Pre-feature-action', 'run-corrupt');
fs.mkdirSync(corruptRunDir, { recursive: true });
fs.writeFileSync(path.join(corruptRunDir, 'sentinel-state.json'), '{bad json');
writeJson(path.join(corrupt, '.pipeline', 'active-run.json'), { pipeline_doc_path: corruptRunDir });
output = {};
guard.handleToolExecuteBefore(editInput(corrupt, path.join(corrupt, 'src', 'app.js')), output);
assert.equal(output.error.code, 'EDIT_GUARD_STATE_CORRUPT');

const inactive = projectWithState(sentinel({ pipeline_active: false }));
output = {};
guard.handleToolExecuteBefore(editInput(inactive.project, path.join(inactive.project, 'src', 'app.js')), output);
assert.equal(output.error, undefined);

const unlocked = projectWithState(sentinel({ runId: 'run-edit-unlocked' }));
const sessionId = 'session-1';
const sessionsDir = path.join(unlocked.project, '.pipeline', 'sessions');
fs.mkdirSync(sessionsDir, { recursive: true });
writeJson(path.join(sessionsDir, `${sessionId}.lock`), {
  session_id: sessionId,
  status: 'active',
  created_at: Date.now(),
  last_seen_at: Date.now(),
  expires_at: Date.now() + 300000,
});
writeJson(path.join(sessionsDir, `${sessionId}.exec-window`), {
  session_id: sessionId,
  ttl_minutes: 5,
});
appendJsonl(path.join(unlocked.runDir, 'gate-decisions.jsonl'), [{ gate: 'EXEC_WINDOW_OPEN', session_id: sessionId, timestamp: Date.now() }]);
output = {};
guard.handleToolExecuteBefore(editInput(unlocked.project, path.join(unlocked.project, 'src', 'app.js')), output);
assert.equal(output.error, undefined);

const pendingUnlocked = projectWithState(sentinel({
  runId: 'run-edit-pending-unlocked',
  pending_blocks: [{ block_type: 'GATE_REQUEST', gate_id: 'gate-1', emitted_at: Date.now() }],
}));
const pendingSessionId = 'session-pending';
const pendingSessionsDir = path.join(pendingUnlocked.project, '.pipeline', 'sessions');
fs.mkdirSync(pendingSessionsDir, { recursive: true });
writeJson(path.join(pendingSessionsDir, `${pendingSessionId}.lock`), {
  session_id: pendingSessionId,
  status: 'active',
  created_at: Date.now(),
  last_seen_at: Date.now(),
  expires_at: Date.now() + 300000,
});
writeJson(path.join(pendingSessionsDir, `${pendingSessionId}.exec-window`), {
  session_id: pendingSessionId,
  ttl_minutes: 5,
});
appendJsonl(path.join(pendingUnlocked.runDir, 'gate-decisions.jsonl'), [{ gate: 'EXEC_WINDOW_OPEN', session_id: pendingSessionId, timestamp: Date.now() }]);
output = {};
guard.handleToolExecuteBefore(editInput(pendingUnlocked.project, path.join(pendingUnlocked.project, 'src', 'app.js')), output);
assert.equal(output.error.code, 'INLINE_WORK_BLOCKED');

const sessionOnly = projectWithState(sentinel({ runId: 'run-edit-session-only', pipeline_active: false }));
const sessionOnlyId = 'session-only';
const sessionOnlyDir = path.join(sessionOnly.project, '.pipeline', 'sessions');
fs.mkdirSync(sessionOnlyDir, { recursive: true });
writeJson(path.join(sessionOnlyDir, `${sessionOnlyId}.lock`), {
  session_id: sessionOnlyId,
  status: 'active',
  created_at: Date.now(),
  last_seen_at: Date.now(),
  expires_at: Date.now() + 300000,
});
output = {};
guard.handleToolExecuteBefore(editInput(sessionOnly.project, path.join(sessionOnly.project, 'src', 'app.js')), output);
assert.equal(output.error.code, 'EDIT_GUARD_EXEC_WINDOW_REQUIRED');

const inactivePending = projectWithState(sentinel({
  runId: 'run-edit-inactive-pending',
  pipeline_active: false,
  pending_blocks: [{ block_type: 'PLAN_MODE_REQUEST', plan_id: 'plan-1', emitted_at: Date.now() }],
}));
output = {};
guard.handleToolExecuteBefore(editInput(inactivePending.project, path.join(inactivePending.project, 'src', 'app.js')), output);
assert.equal(output.error.code, 'INLINE_WORK_BLOCKED');

const hooks = guard.createEditGuardHooks({ projectDir: () => active.project });
output = {};
hooks['tool.execute.before'](editInput(active.project, path.join(active.project, 'src', 'app.js')), output);
assert.equal(output.error.code, 'EDIT_GUARD_EXEC_WINDOW_REQUIRED');

const pluginHooks = plugin.createPipelineAdaptationHooks({ directory: active.project });
output = {};
pluginHooks['tool.execute.before'](editInput(active.project, path.join(active.project, 'src', 'app.js')), output);
assert.equal(output.error.code, 'EDIT_GUARD_EXEC_WINDOW_REQUIRED');

assert.equal(typeof opencodeIndex.createEditGuardHooks, 'function');

console.log('edit guard OK');
