'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeArmPending } = require('../../src/lib/pipeline-arm.cjs');
const gate = require('../../src/opencode/gate-log-gate.cjs');
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
    runId: 'run-gate-log',
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

function projectWithState(state, rows) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w3-4-gate-log-'));
  const runDir = path.join(project, '.pipeline', 'docs', 'Pre-feature-action', state.runId || 'run-gate-log');
  writeJson(path.join(runDir, 'sentinel-state.json'), state);
  writeJson(path.join(project, '.pipeline', 'active-run.json'), { pipeline_doc_path: runDir });
  if (Array.isArray(rows)) appendJsonl(path.join(runDir, 'gate-decisions.jsonl'), rows);
  return { project, runDir };
}

const noStateProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w3-4-no-state-'));
let output = {};
gate.handleToolExecuteBefore({ cwd: noStateProject, tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
assert.equal(output.error, undefined);

// Acceptance: missing trail fails open, because absence is not trusted negative evidence.
const missingTrail = projectWithState(sentinel());
output = {};
gate.handleToolExecuteBefore({ cwd: missingTrail.project, tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
assert.equal(output.error, undefined);

// Acceptance: executor path requires TDD_APPROVAL.
const missingTdd = projectWithState(sentinel(), []);
output = {};
gate.handleToolExecuteBefore({ cwd: missingTdd.project, tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
assert.equal(output.error.code, 'GATE_LOG_MISSING');
assert.deepEqual(output.error.missing, ['TDD_APPROVAL']);

output = {};
gate.handleToolExecuteBefore({ cwd: missingTdd.project, tool: 'task', args: { agentName: '   ', agent: 'pipeline-implementer' } }, output);
assert.equal(output.error.code, 'GATE_LOG_MISSING');

const tddApproved = projectWithState(sentinel(), [{ gate: 'TDD_APPROVAL', run_id: 'run-gate-log' }]);
output = {};
gate.handleToolExecuteBefore({ cwd: tddApproved.project, tool: 'task', args: { agentName: 'Pipeline-Implementer' } }, output);
assert.equal(output.error, undefined);

// Acceptance: final validation path requires ADVERSARIAL_GATE.
const missingAdversarial = projectWithState(sentinel(), [{ gate: 'TDD_APPROVAL', run_id: 'run-gate-log' }]);
output = {};
gate.handleToolExecuteBefore({ cwd: missingAdversarial.project, tool: 'task', args: { agentName: 'pipeline-validator' } }, output);
assert.equal(output.error.code, 'GATE_LOG_MISSING');
assert.deepEqual(output.error.missing, ['ADVERSARIAL_GATE']);

const adversarialDone = projectWithState(sentinel(), [{ gate: 'ADVERSARIAL_GATE', run_id: 'run-gate-log' }]);
output = {};
gate.handleToolExecuteBefore({ cwd: adversarialDone.project, tool: 'task', args: { agentName: 'pipeline-validator' } }, output);
assert.equal(output.error, undefined);

// Acceptance: wrong-run gate evidence does not satisfy the current run.
const staleGate = projectWithState(sentinel(), [{ gate: 'TDD_APPROVAL', run_id: 'other-run' }]);
output = {};
gate.handleToolExecuteBefore({ cwd: staleGate.project, tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
assert.equal(output.error.code, 'GATE_LOG_MISSING');

const staleCamelGate = projectWithState(sentinel(), [{ gate: 'TDD_APPROVAL', runId: 'other-run' }]);
output = {};
gate.handleToolExecuteBefore({ cwd: staleCamelGate.project, tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
assert.equal(output.error.code, 'GATE_LOG_MISSING');

// Acceptance: external gate-decision paths cannot satisfy the active local run.
const externalTrail = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w3-4-external-trail-'));
appendJsonl(path.join(externalTrail, 'gate-decisions.jsonl'), [{ gate: 'TDD_APPROVAL', run_id: 'run-gate-log' }]);
process.env.PIPELINE_DOC_PATH = externalTrail;
try {
  output = {};
  gate.handleToolExecuteBefore({ cwd: missingTdd.project, tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
  assert.equal(output.error.code, 'GATE_LOG_MISSING');
} finally {
  delete process.env.PIPELINE_DOC_PATH;
}

const linkParent = path.join(missingTdd.project, '.pipeline', 'docs', 'Pre-feature-action');
const linkedTrail = path.join(linkParent, 'linked-external-trail');
let linkedTrailCreated = false;
try {
  fs.symlinkSync(externalTrail, linkedTrail, process.platform === 'win32' ? 'junction' : 'dir');
  linkedTrailCreated = true;
} catch (_) {
  // Some environments disallow symlink/junction creation; containment is still enforced in production code.
}
if (linkedTrailCreated) {
  process.env.PIPELINE_DOC_PATH = linkedTrail;
  try {
    output = {};
    gate.handleToolExecuteBefore({ cwd: missingTdd.project, tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
    assert.equal(output.error.code, 'GATE_LOG_MISSING');
  } finally {
    delete process.env.PIPELINE_DOC_PATH;
  }
}

const linkedGateFileProject = projectWithState(sentinel(), []);
const externalGateFile = path.join(externalTrail, 'external-gate-decisions.jsonl');
appendJsonl(externalGateFile, [{ gate: 'TDD_APPROVAL', run_id: 'run-gate-log' }]);
const localGateFile = path.join(linkedGateFileProject.runDir, 'gate-decisions.jsonl');
fs.rmSync(localGateFile, { force: true });
let linkedGateFileCreated = false;
try {
  fs.symlinkSync(externalGateFile, localGateFile, 'file');
  linkedGateFileCreated = true;
} catch (_) {
  // Some environments disallow file symlink creation; file containment is still enforced in production code.
}
if (linkedGateFileCreated) {
  output = {};
  gate.handleToolExecuteBefore({ cwd: linkedGateFileProject.project, tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
  assert.equal(output.error.code, 'GATE_LOG_UNTRUSTED');
}

// Acceptance: inactive runs and ungoverned local agents are allowed.
const inactive = projectWithState(sentinel({ pipeline_active: false }), []);
output = {};
gate.handleToolExecuteBefore({ cwd: inactive.project, tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
assert.equal(output.error, undefined);

output = {};
gate.handleToolExecuteBefore({ cwd: missingTdd.project, tool: 'task', args: { agentName: 'pipeline-adversarial-quality' } }, output);
assert.equal(output.error, undefined);

// Acceptance: warn mode reports a warning instead of blocking for readable gate logs.
process.env.PIPELINE_GATE_LOG_ENFORCEMENT = 'warn';
try {
  output = {};
  gate.handleToolExecuteBefore({ cwd: missingTdd.project, tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
  assert.equal(output.error, undefined);
  assert.equal(output.warning.code, 'GATE_LOG_MISSING');
  assert.deepEqual(output.warning.missing, ['TDD_APPROVAL']);
} finally {
  delete process.env.PIPELINE_GATE_LOG_ENFORCEMENT;
}

// Acceptance: corrupt authoritative state fails closed for governed agents only.
const corruptProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w3-4-gate-corrupt-'));
const corruptRunDir = path.join(corruptProject, '.pipeline', 'docs', 'Pre-feature-action', 'run-corrupt');
fs.mkdirSync(corruptRunDir, { recursive: true });
fs.writeFileSync(path.join(corruptRunDir, 'sentinel-state.json'), '{bad json');
writeJson(path.join(corruptProject, '.pipeline', 'active-run.json'), { pipeline_doc_path: corruptRunDir });

output = {};
gate.handleToolExecuteBefore({ cwd: corruptProject, tool: 'task', args: { agentName: 'pipeline-adversarial-quality' } }, output);
assert.equal(output.error, undefined);

output = {};
gate.handleToolExecuteBefore({ cwd: corruptProject, tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
assert.equal(output.error.code, 'GATE_LOG_STATE_CORRUPT');

process.env.PIPELINE_GATE_LOG_ENFORCEMENT = 'warn';
try {
  output = {};
  gate.handleToolExecuteBefore({ cwd: corruptProject, tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
  assert.equal(output.error.code, 'GATE_LOG_STATE_CORRUPT');
  assert.equal(output.warning, undefined);
} finally {
  delete process.env.PIPELINE_GATE_LOG_ENFORCEMENT;
}

// Acceptance: Claude Code-only subagent_type is ignored in OpenCode.
output = {};
gate.handleToolExecuteBefore({ cwd: missingTdd.project, tool: 'task', args: { subagent_type: 'executor-controller' } }, output);
assert.equal(output.error, undefined);

// Acceptance: hook factory, plugin composition, and index expose W3.4.
const hooks = gate.createGateLogGateHooks({ projectDir: () => missingTdd.project });
output = {};
hooks['tool.execute.before']({ tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
assert.equal(output.error.code, 'GATE_LOG_MISSING');

const pluginHooks = plugin.createPipelineAdaptationHooks({ directory: missingTdd.project });
output = {};
pluginHooks['tool.execute.before']({ tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
assert.equal(output.error.code, 'GATE_LOG_MISSING');

const armProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w3-4-arm-composition-'));
writeArmPending(armProject, '/pipeline feature criar tela', new Date().toISOString());
const composedHooks = plugin.createPipelineAdaptationHooks({ directory: armProject });
output = {};
composedHooks['tool.execute.before']({ tool: 'edit', args: { filePath: path.join(armProject, 'src', 'x.js') } }, output);
assert.equal(output.error.code, 'PIPELINE_NOT_ARMED');

assert.equal(typeof opencodeIndex.createGateLogGateHooks, 'function');

console.log('gate log gate OK');
