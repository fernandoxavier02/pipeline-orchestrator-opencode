'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const hook = require('../../src/opencode/dispatch-record-hook.cjs');
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
    runId: 'run-dispatch-record',
    currentPhase: 'phase_1_to_2',
    currentStep: 'execute',
    evidenceSummary: 'red-green-ready',
    checkpoints: {},
    blocked: false,
    stopRuleTriggered: false,
    lastValidEventId: null,
    updatedAt: new Date().toISOString(),
    pipeline_active: true,
    workflow_key: 'FULL',
    step_ledger: ['classify', 'info-gate', 'plan', 'tdd'],
    pending_blocks: [],
    ...overrides,
  };
}

function projectWithState(state) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w4-2-dispatch-record-'));
  const runDir = path.join(project, '.pipeline', 'docs', 'Pre-feature-action', state.runId || 'run-dispatch-record');
  const statePath = path.join(runDir, 'sentinel-state.json');
  writeJson(statePath, state);
  writeJson(path.join(project, '.pipeline', 'active-run.json'), { pipeline_doc_path: runDir });
  return { project, runDir, statePath };
}

// Acceptance: absent state is inert and does not mutate subagent prompts.
let output = {};
hook.handleToolExecuteBefore({ cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'po-w4-2-no-state-')), tool: 'task', args: { agentName: 'pipeline-implementer', prompt: 'do work' }, tool_use_id: 'dispatch-absent' }, output);
assert.equal(output.error, undefined);
assert.equal(output.args, undefined);

const governed = projectWithState(sentinel());

// Acceptance: governed subagent dispatch is recorded and its prompt receives one envelope.
output = {};
hook.handleToolExecuteBefore({ cwd: governed.project, tool: 'task', args: { agentName: 'pipeline-implementer', prompt: 'do the delegated work', description: 'impl' }, tool_use_id: 'dispatch-123' }, output, { nowIso: '2026-06-22T15:00:00.000Z' });
assert.equal(output.error, undefined);
assert.match(output.args.prompt, /^\[PIPELINE run=run-dispatch-record dispatch=dispatch-123 phase=phase_1_to_2 step=execute evidence=red-green-ready\]\ndo the delegated work$/);
assert.equal(output.args.description, 'impl');

let written = readJson(governed.statePath);
assert.equal(written.pending_dispatches['dispatch-123'].dispatch_id, 'dispatch-123');
assert.equal(written.pending_dispatches['dispatch-123'].run_id, 'run-dispatch-record');
assert.equal(written.pending_dispatches['dispatch-123'].agent_type, 'pipeline-implementer');
assert.equal(written.pending_dispatches['dispatch-123'].status, 'pending');
assert.equal(written.pending_dispatches['dispatch-123'].created_at, '2026-06-22T15:00:00.000Z');
assert.equal(written.state_version, 1);
const firstEnvelopedPrompt = output.args.prompt;

// Acceptance: re-dispatch strips an existing envelope instead of stacking headers.
output = {};
hook.handleToolExecuteBefore({ cwd: governed.project, tool: 'task', args: { agentName: 'pipeline-implementer', prompt: firstEnvelopedPrompt }, tool_use_id: 'dispatch-456' }, output, { nowIso: '2026-06-22T15:01:00.000Z' });
assert.equal((output.args.prompt.match(/^\[PIPELINE run=/gm) || []).length, 1);
assert.match(output.args.prompt, /dispatch=dispatch-456/);
assert.match(output.args.prompt, /\ndo the delegated work$/);

written = readJson(governed.statePath);
assert.equal(written.pending_dispatches['dispatch-456'].dispatch_id, 'dispatch-456');
assert.equal(written.state_version, 2);

// Acceptance: missing runtime ids do not collapse every dispatch into one "unknown" key.
output = {};
hook.handleToolExecuteBefore({ cwd: governed.project, tool: 'task', args: { agentName: 'pipeline-implementer', prompt: 'no id dispatch' } }, output, { nowIso: '2026-06-22T15:01:30.000Z' });
assert.match(output.args.prompt, /dispatch=unknown-/);
written = readJson(governed.statePath);
const fallbackIds = Object.keys(written.pending_dispatches).filter((id) => id.startsWith('unknown-'));
assert.equal(fallbackIds.length, 1);
assert.equal(written.pending_dispatches[fallbackIds[0]].agent_type, 'pipeline-implementer');

// Acceptance: OpenCode-style output.args wins over stale input args and is preserved.
output = { args: { prompt: 'prompt from output args', description: 'kept from output' } };
hook.handleToolExecuteBefore({ cwd: governed.project, tool: 'task', args: { agentName: 'pipeline-implementer', prompt: 'stale input prompt' }, tool_use_id: 'dispatch-output-args' }, output, { nowIso: '2026-06-22T15:01:45.000Z' });
assert.match(output.args.prompt, /\nprompt from output args$/);
assert.equal(output.args.description, 'kept from output');

// Acceptance: if the state write fails, the subagent is blocked and no envelope is released.
output = {};
hook.handleToolExecuteBefore(
  { cwd: governed.project, tool: 'task', args: { agentName: 'pipeline-implementer', prompt: 'must not run unrecorded' }, tool_use_id: 'dispatch-write-fail' },
  output,
  { nowIso: '2026-06-22T15:01:50.000Z', writeDispatchRecord: () => false },
);
assert.equal(output.error.code, 'DISPATCH_RECORD_WRITE_FAILED');
assert.equal(output.args, undefined);

// Acceptance: envelope fields are tokenized so state text cannot inject fake header fields.
const injectedHeader = hook.buildEnvelopedPrompt('body', {
  runId: 'run x dispatch=bad',
  dispatchId: 'id] phase=bad',
  phase: 'phase one',
  step: 'step=x',
  evidence: 'ok now',
}).split('\n')[0];
assert.equal(injectedHeader, '[PIPELINE run=run_x_dispatch_bad dispatch=id_phase_bad phase=phase_one step=step_x evidence=ok_now]');

// Acceptance: legacy Agent-shaped inputs are governed too.
const legacy = projectWithState(sentinel({ runId: 'run-legacy-agent', step_ledger: [] }));
output = {};
hook.handleToolExecuteBefore({ cwd: legacy.project, toolName: 'Agent', agentName: 'pipeline-pre-tester', prompt: 'write red test', toolUseId: 'legacy-1' }, output, { nowIso: '2026-06-22T15:02:00.000Z' });
assert.match(output.args.prompt, /dispatch=legacy-1/);
assert.equal(readJson(legacy.statePath).pending_dispatches['legacy-1'].agent_type, 'pipeline-pre-tester');

// Acceptance: inactive runs are not governed.
const inactive = projectWithState(sentinel({ runId: 'run-inactive', pipeline_active: false }));
output = {};
hook.handleToolExecuteBefore({ cwd: inactive.project, tool: 'task', args: { agentName: 'pipeline-implementer', prompt: 'do work' }, tool_use_id: 'inactive-1' }, output);
assert.equal(output.args, undefined);
assert.equal(readJson(inactive.statePath).pending_dispatches, undefined);

// Acceptance: corrupt authoritative state fails closed for agent dispatches.
const corruptProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w4-2-dispatch-corrupt-'));
const corruptRunDir = path.join(corruptProject, '.pipeline', 'docs', 'Pre-feature-action', 'run-corrupt');
fs.mkdirSync(corruptRunDir, { recursive: true });
fs.writeFileSync(path.join(corruptRunDir, 'sentinel-state.json'), '{bad json');
writeJson(path.join(corruptProject, '.pipeline', 'active-run.json'), { pipeline_doc_path: corruptRunDir });
output = {};
hook.handleToolExecuteBefore({ cwd: corruptProject, tool: 'task', args: { agentName: 'pipeline-implementer', prompt: 'do work' }, tool_use_id: 'corrupt-1' }, output);
assert.equal(output.error.code, 'DISPATCH_RECORD_STATE_CORRUPT');

// Acceptance: hook factory, plugin composition, and index expose W4.2.
const hooks = hook.createDispatchRecordHooks({ projectDir: () => governed.project, nowIso: '2026-06-22T15:03:00.000Z' });
output = {};
hooks['tool.execute.before']({ tool: 'task', args: { agentName: 'pipeline-validator', prompt: 'validate' }, tool_use_id: 'dispatch-789' }, output);
assert.match(output.args.prompt, /dispatch=dispatch-789/);

const pluginHooks = plugin.createPipelineAdaptationHooks({ directory: governed.project }, { nowIso: '2026-06-22T15:04:00.000Z' });
output = {};
pluginHooks['tool.execute.before']({ tool: 'task', args: { agentName: 'pipeline-run-orchestrator', prompt: 'classify and route' }, tool_use_id: 'dispatch-plugin' }, output);
assert.match(output.args.prompt, /dispatch=dispatch-plugin/);

assert.equal(typeof opencodeIndex.createDispatchRecordHooks, 'function');

console.log('dispatch record hook OK');
