'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeArmPending } = require('../../src/lib/pipeline-arm.cjs');
const gate = require('../../src/opencode/batch-review-gate.cjs');
const plugin = require('../../src/opencode/pipeline-adaptation-plugin.cjs');
const opencodeIndex = require('../../src/opencode/index.cjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function sentinel(overrides = {}) {
  return {
    schemaVersion: 'SENTINEL_STATE/v1',
    runId: 'run-batch-review',
    currentPhase: 'phase_1_to_2',
    checkpoints: {},
    blocked: false,
    stopRuleTriggered: false,
    lastValidEventId: null,
    updatedAt: new Date().toISOString(),
    pipeline_active: true,
    workflow_key: 'FULL',
    step_ledger: ['classify', 'info-gate', 'plan', 'tdd', 'execute'],
    batch_checkpoints_done: 0,
    batch_reviews_done: 0,
    ...overrides,
  };
}

function projectWithState(state) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w3-1-batch-review-'));
  const runDir = path.join(project, '.pipeline', 'docs', 'Pre-feature-action', 'run-batch-review');
  writeJson(path.join(runDir, 'sentinel-state.json'), state);
  writeJson(path.join(project, '.pipeline', 'active-run.json'), { pipeline_doc_path: runDir });
  return project;
}

// Acceptance: absent state and ungoverned agents are migration-tolerant.
let output = {};
gate.handleToolExecuteBefore({ cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'po-w3-1-no-state-')), tool: 'task', args: { agentName: 'pipeline-validator' } }, output);
assert.equal(output.error, undefined);

const project = projectWithState(sentinel({ batch_checkpoints_done: 1, batch_reviews_done: 0 }));
output = {};
gate.handleToolExecuteBefore({ cwd: project, tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
assert.equal(output.error, undefined);

// Acceptance: local pipeline-validator maps to canonical final-validator and blocks if reviews lag.
output = {};
gate.handleToolExecuteBefore({ cwd: project, tool: 'task', args: { agentName: 'pipeline-validator' } }, output);
assert.equal(output.error.code, 'BATCH_REVIEW_MISSING');
assert.equal(output.error.checkpoints, 1);
assert.equal(output.error.reviews, 0);

// Acceptance: canonical checkpoint-validator and final-validator names are also governed.
output = {};
gate.handleToolExecuteBefore({ cwd: project, tool: 'task', args: { agentName: 'checkpoint-validator' } }, output);
assert.equal(output.error.code, 'BATCH_REVIEW_MISSING');

output = {};
gate.handleToolExecuteBefore({ cwd: project, tool: 'task', args: { agentName: 'final-validator' } }, output);
assert.equal(output.error.code, 'BATCH_REVIEW_MISSING');

output = {};
gate.handleToolExecuteBefore({ cwd: project, tool: 'task', args: { agentName: 'final-validator ' } }, output);
assert.equal(output.error.code, 'BATCH_REVIEW_MISSING');

// Acceptance: once reviews catch up, governed agents are allowed.
const reviewedProject = projectWithState(sentinel({ batch_checkpoints_done: 2, batch_reviews_done: 2 }));
output = {};
gate.handleToolExecuteBefore({ cwd: reviewedProject, tool: 'task', args: { agentName: 'pipeline-validator' } }, output);
assert.equal(output.error, undefined);

// Acceptance: absent counters default to 0 and do not block.
const legacyProject = projectWithState(sentinel({ batch_checkpoints_done: undefined, batch_reviews_done: undefined }));
output = {};
gate.handleToolExecuteBefore({ cwd: legacyProject, tool: 'task', args: { agentName: 'pipeline-validator' } }, output);
assert.equal(output.error, undefined);

// Acceptance: inactive run is not governed.
const inactiveProject = projectWithState(sentinel({ pipeline_active: false, batch_checkpoints_done: 1, batch_reviews_done: 0 }));
output = {};
gate.handleToolExecuteBefore({ cwd: inactiveProject, tool: 'task', args: { agentName: 'pipeline-validator' } }, output);
assert.equal(output.error, undefined);

// Acceptance: sensitive domains ignore warn escape and stay blocked.
process.env.PIPELINE_BATCH_REVIEW_ENFORCEMENT = 'warn';
try {
  const sensitiveProject = projectWithState(sentinel({ batch_checkpoints_done: 1, batch_reviews_done: 0, domains_touched: ['auth'] }));
  output = {};
  gate.handleToolExecuteBefore({ cwd: sensitiveProject, tool: 'task', args: { agentName: 'pipeline-validator' } }, output);
  assert.equal(output.error.code, 'BATCH_REVIEW_MISSING');
  assert.equal(output.warning, undefined);

  output = {};
  gate.handleToolExecuteBefore({ cwd: project, tool: 'task', args: { agentName: 'pipeline-validator' } }, output);
  assert.equal(output.error, undefined);
  assert.equal(output.warning.code, 'BATCH_REVIEW_MISSING');
} finally {
  delete process.env.PIPELINE_BATCH_REVIEW_ENFORCEMENT;
}

// Acceptance: corrupt authoritative state fails closed for governed agents only.
const corruptProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w3-1-batch-corrupt-'));
const corruptRunDir = path.join(corruptProject, '.pipeline', 'docs', 'Pre-feature-action', 'run-corrupt');
fs.mkdirSync(corruptRunDir, { recursive: true });
fs.writeFileSync(path.join(corruptRunDir, 'sentinel-state.json'), '{bad json');
writeJson(path.join(corruptProject, '.pipeline', 'active-run.json'), { pipeline_doc_path: corruptRunDir });

output = {};
gate.handleToolExecuteBefore({ cwd: corruptProject, tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
assert.equal(output.error, undefined);

output = {};
gate.handleToolExecuteBefore({ cwd: corruptProject, tool: 'task', args: { agentName: 'pipeline-validator' } }, output);
assert.equal(output.error.code, 'BATCH_REVIEW_STATE_CORRUPT');

// Acceptance: Claude Code-only subagent_type is ignored in OpenCode.
output = {};
gate.handleToolExecuteBefore({ cwd: project, tool: 'task', args: { subagent_type: 'final-validator' } }, output);
assert.equal(output.error, undefined);

// Acceptance: hook factory, plugin composition, and index expose W3.1.
const hooks = gate.createBatchReviewGateHooks({ projectDir: () => project });
output = {};
hooks['tool.execute.before']({ tool: 'task', args: { agentName: 'pipeline-validator' } }, output);
assert.equal(output.error.code, 'BATCH_REVIEW_MISSING');

const pluginBatchProject = projectWithState(sentinel({
  step_ledger: ['classify', 'info-gate', 'plan', 'tdd', 'execute', 'adversarial', 'sanity'],
  batch_checkpoints_done: 1,
  batch_reviews_done: 0,
}));
const pluginHooks = plugin.createPipelineAdaptationHooks({ directory: pluginBatchProject });
output = {};
pluginHooks['tool.execute.before']({ tool: 'task', args: { agentName: 'pipeline-validator' } }, output);
assert.equal(output.error.code, 'BATCH_REVIEW_MISSING');

const armProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w3-1-arm-composition-'));
writeArmPending(armProject, '/pipeline feature criar tela', new Date().toISOString());
const composedHooks = plugin.createPipelineAdaptationHooks({ directory: armProject });
output = {};
composedHooks['tool.execute.before']({ tool: 'edit', args: { filePath: path.join(armProject, 'src', 'x.js') } }, output);
assert.equal(output.error.code, 'PIPELINE_NOT_ARMED');

assert.equal(typeof opencodeIndex.createBatchReviewGateHooks, 'function');

console.log('batch review gate OK');
