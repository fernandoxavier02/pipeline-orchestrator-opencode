'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeArmPending } = require('../../src/lib/pipeline-arm.cjs');
const gate = require('../../src/opencode/checkpoint-verdict-gate.cjs');
const plugin = require('../../src/opencode/pipeline-adaptation-plugin.cjs');
const opencodeIndex = require('../../src/opencode/index.cjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function sentinel(overrides = {}) {
  return {
    schemaVersion: 'SENTINEL_STATE/v1',
    runId: 'run-checkpoint-verdict',
    currentPhase: 'phase_1_to_2',
    checkpoints: {},
    blocked: false,
    stopRuleTriggered: false,
    lastValidEventId: null,
    updatedAt: new Date().toISOString(),
    pipeline_active: true,
    workflow_key: 'FULL',
    step_ledger: ['classify', 'info-gate', 'plan', 'tdd', 'execute', 'adversarial', 'sanity'],
    batch_checkpoints_done: 1,
    batch_reviews_done: 1,
    last_checkpoint_verdict: 'pass',
    consecutive_checkpoint_failures: 0,
    ...overrides,
  };
}

function projectWithState(state) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w3-2-checkpoint-verdict-'));
  const runDir = path.join(project, '.pipeline', 'docs', 'Pre-feature-action', 'run-checkpoint-verdict');
  writeJson(path.join(runDir, 'sentinel-state.json'), state);
  writeJson(path.join(project, '.pipeline', 'active-run.json'), { pipeline_doc_path: runDir });
  return project;
}

// Acceptance: absent state and ungoverned agents are migration-tolerant.
let output = {};
gate.handleToolExecuteBefore({ cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'po-w3-2-no-state-')), tool: 'task', args: { agentName: 'pipeline-validator' } }, output);
assert.equal(output.error, undefined);

const redProject = projectWithState(sentinel({ last_checkpoint_verdict: 'fail' }));
output = {};
gate.handleToolExecuteBefore({ cwd: redProject, tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
assert.equal(output.error, undefined);

// A1: local pipeline-validator maps to canonical final-validator and blocks on RED checkpoint.
output = {};
gate.handleToolExecuteBefore({ cwd: redProject, tool: 'task', args: { agentName: 'pipeline-validator' } }, output);
assert.equal(output.error.code, 'CHECKPOINT_RED');
assert.equal(output.error.lastVerdict, 'fail');

// A1: canonical review-orchestrator and final-validator names are also governed.
output = {};
gate.handleToolExecuteBefore({ cwd: redProject, tool: 'task', args: { agentName: 'review-orchestrator' } }, output);
assert.equal(output.error.code, 'CHECKPOINT_RED');

output = {};
gate.handleToolExecuteBefore({ cwd: redProject, tool: 'task', args: { agentName: 'final-validator ' } }, output);
assert.equal(output.error.code, 'CHECKPOINT_RED');

output = {};
gate.handleToolExecuteBefore({ cwd: redProject, tool: 'task', args: { agentName: 'Pipeline-Validator' } }, output);
assert.equal(output.error.code, 'CHECKPOINT_RED');

// A2/A3: two consecutive checkpoint failures trigger STOP_RULE.
const stopProject = projectWithState(sentinel({ last_checkpoint_verdict: 'fail', consecutive_checkpoint_failures: 2 }));
output = {};
gate.handleToolExecuteBefore({ cwd: stopProject, tool: 'task', args: { agentName: 'pipeline-validator' } }, output);
assert.equal(output.error.code, 'STOP_RULE');
assert.equal(output.error.failures, 2);

// Acceptance: green checkpoint and failures below cap allow governed advance.
const greenProject = projectWithState(sentinel({ last_checkpoint_verdict: 'green', consecutive_checkpoint_failures: 1 }));
output = {};
gate.handleToolExecuteBefore({ cwd: greenProject, tool: 'task', args: { agentName: 'pipeline-validator' } }, output);
assert.equal(output.error, undefined);

// Acceptance: absent verdict/counter and inactive runs do not block.
const legacyProject = projectWithState(sentinel({ last_checkpoint_verdict: undefined, consecutive_checkpoint_failures: undefined }));
output = {};
gate.handleToolExecuteBefore({ cwd: legacyProject, tool: 'task', args: { agentName: 'pipeline-validator' } }, output);
assert.equal(output.error, undefined);

const inactiveProject = projectWithState(sentinel({ pipeline_active: false, last_checkpoint_verdict: 'fail', consecutive_checkpoint_failures: 2 }));
output = {};
gate.handleToolExecuteBefore({ cwd: inactiveProject, tool: 'task', args: { agentName: 'pipeline-validator' } }, output);
assert.equal(output.error, undefined);

// Acceptance: warn mode reports a warning instead of blocking.
process.env.PIPELINE_CHECKPOINT_VERDICT_ENFORCEMENT = 'warn';
try {
  output = {};
  gate.handleToolExecuteBefore({ cwd: redProject, tool: 'task', args: { agentName: 'pipeline-validator' } }, output);
  assert.equal(output.error, undefined);
  assert.equal(output.warning.code, 'CHECKPOINT_RED');

  output = {};
  gate.handleToolExecuteBefore({ cwd: stopProject, tool: 'task', args: { agentName: 'pipeline-validator' } }, output);
  assert.equal(output.error, undefined);
  assert.equal(output.warning.code, 'STOP_RULE');
} finally {
  delete process.env.PIPELINE_CHECKPOINT_VERDICT_ENFORCEMENT;
}

// Acceptance: corrupt authoritative state fails closed for governed agents only.
const corruptProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w3-2-checkpoint-corrupt-'));
const corruptRunDir = path.join(corruptProject, '.pipeline', 'docs', 'Pre-feature-action', 'run-corrupt');
fs.mkdirSync(corruptRunDir, { recursive: true });
fs.writeFileSync(path.join(corruptRunDir, 'sentinel-state.json'), '{bad json');
writeJson(path.join(corruptProject, '.pipeline', 'active-run.json'), { pipeline_doc_path: corruptRunDir });

output = {};
gate.handleToolExecuteBefore({ cwd: corruptProject, tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
assert.equal(output.error, undefined);

output = {};
gate.handleToolExecuteBefore({ cwd: corruptProject, tool: 'task', args: { agentName: 'pipeline-validator' } }, output);
assert.equal(output.error.code, 'CHECKPOINT_STATE_CORRUPT');

process.env.PIPELINE_CHECKPOINT_VERDICT_ENFORCEMENT = 'warn';
try {
  output = {};
  gate.handleToolExecuteBefore({ cwd: corruptProject, tool: 'task', args: { agentName: 'pipeline-validator' } }, output);
  assert.equal(output.error.code, 'CHECKPOINT_STATE_CORRUPT');
  assert.equal(output.warning, undefined);
} finally {
  delete process.env.PIPELINE_CHECKPOINT_VERDICT_ENFORCEMENT;
}

// Acceptance: Claude Code-only subagent_type is ignored in OpenCode.
output = {};
gate.handleToolExecuteBefore({ cwd: redProject, tool: 'task', args: { subagent_type: 'final-validator' } }, output);
assert.equal(output.error, undefined);

// Acceptance: hook factory, plugin composition, and index expose W3.2.
const hooks = gate.createCheckpointVerdictGateHooks({ projectDir: () => redProject });
output = {};
hooks['tool.execute.before']({ tool: 'task', args: { agentName: 'pipeline-validator' } }, output);
assert.equal(output.error.code, 'CHECKPOINT_RED');

const pluginHooks = plugin.createPipelineAdaptationHooks({ directory: redProject });
output = {};
pluginHooks['tool.execute.before']({ tool: 'task', args: { agentName: 'pipeline-validator' } }, output);
assert.equal(output.error.code, 'CHECKPOINT_RED');

const armProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w3-2-arm-composition-'));
writeArmPending(armProject, '/pipeline feature criar tela', new Date().toISOString());
const composedHooks = plugin.createPipelineAdaptationHooks({ directory: armProject });
output = {};
composedHooks['tool.execute.before']({ tool: 'edit', args: { filePath: path.join(armProject, 'src', 'x.js') } }, output);
assert.equal(output.error.code, 'PIPELINE_NOT_ARMED');

assert.equal(typeof opencodeIndex.createCheckpointVerdictGateHooks, 'function');

console.log('checkpoint verdict gate OK');
