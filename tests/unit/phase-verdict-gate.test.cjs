'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeArmPending } = require('../../src/lib/pipeline-arm.cjs');
const gate = require('../../src/opencode/phase-verdict-gate.cjs');
const plugin = require('../../src/opencode/pipeline-adaptation-plugin.cjs');
const opencodeIndex = require('../../src/opencode/index.cjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function sentinel(overrides = {}) {
  return {
    schemaVersion: 'SENTINEL_STATE/v1',
    runId: 'run-phase-verdict',
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
    ...overrides,
  };
}

function projectWithState(state) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w3-3-phase-verdict-'));
  const runDir = path.join(project, '.pipeline', 'docs', 'Pre-feature-action', 'run-phase-verdict');
  writeJson(path.join(runDir, 'sentinel-state.json'), state);
  writeJson(path.join(project, '.pipeline', 'active-run.json'), { pipeline_doc_path: runDir });
  return project;
}

// Acceptance: absent state and ungoverned agents are migration-tolerant.
let output = {};
gate.handleToolExecuteBefore({ cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'po-w3-3-no-state-')), tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
assert.equal(output.error, undefined);

const ssotProject = projectWithState(sentinel({ ssot_status: 'conflict' }));
output = {};
gate.handleToolExecuteBefore({ cwd: ssotProject, tool: 'task', args: { agentName: 'checkpoint-validator' } }, output);
assert.equal(output.error, undefined);

// A5: SSOT conflict blocks governed progress agents.
output = {};
gate.handleToolExecuteBefore({ cwd: ssotProject, tool: 'task', args: { agentName: 'Pipeline-Implementer' } }, output);
assert.equal(output.error.code, 'SSOT_CONFLICT');

output = {};
gate.handleToolExecuteBefore({ cwd: ssotProject, tool: 'task', args: { agentName: '   ', agent: 'pipeline-implementer' } }, output);
assert.equal(output.error.code, 'SSOT_CONFLICT');

// A6: blocked information gate blocks planning and execution.
const infoBlockedProject = projectWithState(sentinel({ info_gate: 'blocked' }));
output = {};
gate.handleToolExecuteBefore({ cwd: infoBlockedProject, tool: 'task', args: { agentName: 'pipeline-planner' } }, output);
assert.equal(output.error.code, 'INFO_GATE_BLOCKED');

output = {};
gate.handleToolExecuteBefore({ cwd: infoBlockedProject, tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
assert.equal(output.error.code, 'INFO_GATE_BLOCKED');

// A7: rejected plan blocks execution.
const planRejectedProject = projectWithState(sentinel({ plan_status: 'rejected' }));
output = {};
gate.handleToolExecuteBefore({ cwd: planRejectedProject, tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
assert.equal(output.error.code, 'PLAN_REJECTED');

// A8: final adversarial critical rework blocks finishing.
const finalReworkProject = projectWithState(sentinel({ final_review_verdict: 'critical_open' }));
output = {};
gate.handleToolExecuteBefore({ cwd: finalReworkProject, tool: 'task', args: { agentName: 'finishing-branch' } }, output);
assert.equal(output.error.code, 'FINAL_ADVERSARIAL_REWORK');

output = {};
gate.handleToolExecuteBefore({ cwd: finalReworkProject, tool: 'task', args: { agentName: 'pipeline-validator' } }, output);
assert.equal(output.error.code, 'FINAL_ADVERSARIAL_REWORK');

// A9: NO-GO final decision blocks finishing.
const noGoProject = projectWithState(sentinel({ final_decision: 'NO-GO' }));
output = {};
gate.handleToolExecuteBefore({ cwd: noGoProject, tool: 'task', args: { agentName: 'finishing-branch ' } }, output);
assert.equal(output.error.code, 'GO_NOGO_BLOCK');

output = {};
gate.handleToolExecuteBefore({ cwd: noGoProject, tool: 'task', args: { agentName: 'pipeline-validator' } }, output);
assert.equal(output.error.code, 'GO_NOGO_BLOCK');

// Acceptance: inactive run and clean phase verdicts allow governed agents.
const inactiveProject = projectWithState(sentinel({ pipeline_active: false, ssot_status: 'conflict' }));
output = {};
gate.handleToolExecuteBefore({ cwd: inactiveProject, tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
assert.equal(output.error, undefined);

const cleanProject = projectWithState(sentinel());
output = {};
gate.handleToolExecuteBefore({ cwd: cleanProject, tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
assert.equal(output.error, undefined);

// Acceptance: warn mode reports a warning instead of blocking for valid state verdicts.
process.env.PIPELINE_PHASE_VERDICT_ENFORCEMENT = 'warn';
try {
  output = {};
  gate.handleToolExecuteBefore({ cwd: planRejectedProject, tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
  assert.equal(output.error, undefined);
  assert.equal(output.warning.code, 'PLAN_REJECTED');
} finally {
  delete process.env.PIPELINE_PHASE_VERDICT_ENFORCEMENT;
}

// Acceptance: corrupt authoritative state fails closed for governed agents only.
const corruptProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w3-3-phase-corrupt-'));
const corruptRunDir = path.join(corruptProject, '.pipeline', 'docs', 'Pre-feature-action', 'run-corrupt');
fs.mkdirSync(corruptRunDir, { recursive: true });
fs.writeFileSync(path.join(corruptRunDir, 'sentinel-state.json'), '{bad json');
writeJson(path.join(corruptProject, '.pipeline', 'active-run.json'), { pipeline_doc_path: corruptRunDir });

output = {};
gate.handleToolExecuteBefore({ cwd: corruptProject, tool: 'task', args: { agentName: 'checkpoint-validator' } }, output);
assert.equal(output.error, undefined);

output = {};
gate.handleToolExecuteBefore({ cwd: corruptProject, tool: 'task', args: { agentName: 'pipeline-adversarial-quality' } }, output);
assert.equal(output.error, undefined);

output = {};
gate.handleToolExecuteBefore({ cwd: corruptProject, tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
assert.equal(output.error.code, 'PHASE_VERDICT_STATE_CORRUPT');

process.env.PIPELINE_PHASE_VERDICT_ENFORCEMENT = 'warn';
try {
  output = {};
  gate.handleToolExecuteBefore({ cwd: corruptProject, tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
  assert.equal(output.error.code, 'PHASE_VERDICT_STATE_CORRUPT');
  assert.equal(output.warning, undefined);
} finally {
  delete process.env.PIPELINE_PHASE_VERDICT_ENFORCEMENT;
}

// Acceptance: Claude Code-only subagent_type is ignored in OpenCode.
output = {};
gate.handleToolExecuteBefore({ cwd: planRejectedProject, tool: 'task', args: { subagent_type: 'executor-controller' } }, output);
assert.equal(output.error, undefined);

// Acceptance: hook factory, plugin composition, and index expose W3.3.
const hooks = gate.createPhaseVerdictGateHooks({ projectDir: () => planRejectedProject });
output = {};
hooks['tool.execute.before']({ tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
assert.equal(output.error.code, 'PLAN_REJECTED');

const pluginHooks = plugin.createPipelineAdaptationHooks({ directory: planRejectedProject });
output = {};
pluginHooks['tool.execute.before']({ tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
assert.equal(output.error.code, 'PLAN_REJECTED');

const armProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w3-3-arm-composition-'));
writeArmPending(armProject, '/pipeline feature criar tela', new Date().toISOString());
const composedHooks = plugin.createPipelineAdaptationHooks({ directory: armProject });
output = {};
composedHooks['tool.execute.before']({ tool: 'edit', args: { filePath: path.join(armProject, 'src', 'x.js') } }, output);
assert.equal(output.error.code, 'PIPELINE_NOT_ARMED');

assert.equal(typeof opencodeIndex.createPhaseVerdictGateHooks, 'function');

console.log('phase verdict gate OK');
