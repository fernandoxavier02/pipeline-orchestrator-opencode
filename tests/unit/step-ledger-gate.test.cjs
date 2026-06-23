'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeArmPending } = require('../../src/lib/pipeline-arm.cjs');
const gate = require('../../src/opencode/step-ledger-gate.cjs');
const plugin = require('../../src/opencode/pipeline-adaptation-plugin.cjs');
const opencodeIndex = require('../../src/opencode/index.cjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function sentinel(overrides = {}) {
  return {
    schemaVersion: 'SENTINEL_STATE/v1',
    runId: 'run-step-ledger',
    currentPhase: 'phase_1_to_2',
    checkpoints: {},
    blocked: false,
    stopRuleTriggered: false,
    lastValidEventId: null,
    updatedAt: new Date().toISOString(),
    pipeline_active: true,
    workflow_key: 'FULL',
    step_ledger: [],
    ...overrides,
  };
}

function projectWithState(state) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w2-2-step-ledger-'));
  const runDir = path.join(project, '.pipeline', 'docs', 'Pre-feature-action', 'run-step-ledger');
  writeJson(path.join(runDir, 'sentinel-state.json'), state);
  writeJson(path.join(project, '.pipeline', 'active-run.json'), { pipeline_doc_path: runDir });
  return project;
}

// Acceptance: absent state is migration-tolerant and allows task spawn.
let output = {};
gate.handleToolExecuteBefore({ cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'po-w2-2-no-state-')), tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
assert.equal(output.error, undefined);

// Acceptance: active state without step_ledger is inert until stamping is wired.
const noLedgerProject = projectWithState(sentinel({ step_ledger: undefined }));
output = {};
gate.handleToolExecuteBefore({ cwd: noLedgerProject, tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
assert.equal(output.error, undefined);

// Acceptance: first classified agent is allowed, but later agents require prior stamps.
const project = projectWithState(sentinel({ step_ledger: [] }));
output = {};
gate.handleToolExecuteBefore({ cwd: project, tool: 'task', args: { agentName: 'pipeline-run-orchestrator' } }, output);
assert.equal(output.error, undefined);

output = {};
gate.handleToolExecuteBefore({ cwd: project, tool: 'task', args: { agentName: 'pipeline-information-gate' } }, output);
assert.equal(output.error.code, 'STEP_LEDGER_VIOLATION');
assert.deepEqual(output.error.missing, ['classify']);

const infoProject = projectWithState(sentinel({ step_ledger: ['classify'] }));
output = {};
gate.handleToolExecuteBefore({ cwd: infoProject, tool: 'task', args: { agentName: 'pipeline-information-gate' } }, output);
assert.equal(output.error, undefined);

// Acceptance: OpenCode agent names map to canonical ledger leaves.
output = {};
gate.handleToolExecuteBefore({ cwd: infoProject, tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
assert.equal(output.error.code, 'STEP_LEDGER_VIOLATION');
assert.deepEqual(output.error.missing, ['info-gate', 'plan', 'tdd']);

// Acceptance: inactive runs are not governed.
const inactiveProject = projectWithState(sentinel({ pipeline_active: false, step_ledger: [] }));
output = {};
gate.handleToolExecuteBefore({ cwd: inactiveProject, tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
assert.equal(output.error, undefined);

// Acceptance: corrupt authoritative state fails closed only for governed phase-transition agents.
const corruptProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w2-2-corrupt-'));
const corruptRunDir = path.join(corruptProject, '.pipeline', 'docs', 'Pre-feature-action', 'run-corrupt');
fs.mkdirSync(corruptRunDir, { recursive: true });
fs.writeFileSync(path.join(corruptRunDir, 'sentinel-state.json'), '{bad json');
writeJson(path.join(corruptProject, '.pipeline', 'active-run.json'), { pipeline_doc_path: corruptRunDir });

output = {};
gate.handleToolExecuteBefore({ cwd: corruptProject, tool: 'task', args: { agentName: 'pipeline-pre-tester' } }, output);
assert.equal(output.error, undefined);

output = {};
gate.handleToolExecuteBefore({ cwd: corruptProject, tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
assert.equal(output.error.code, 'STEP_LEDGER_STATE_CORRUPT');

// Acceptance: environment warn mode is not an OpenCode bypass.
process.env.PIPELINE_STEP_LEDGER_ENFORCEMENT = 'warn';
try {
  output = {};
  gate.handleToolExecuteBefore({ cwd: project, tool: 'task', args: { agentName: 'pipeline-information-gate' } }, output);
  assert.equal(output.error.code, 'STEP_LEDGER_VIOLATION');
  assert.equal(output.warning, undefined);
} finally {
  delete process.env.PIPELINE_STEP_LEDGER_ENFORCEMENT;
}

// Acceptance: Claude Code-only subagent_type is ignored in OpenCode.
output = {};
gate.handleToolExecuteBefore({ cwd: project, tool: 'task', args: { subagent_type: 'pipeline:executor-controller' } }, output);
assert.equal(output.error, undefined);

// Acceptance: hook factory, plugin factory, and index expose the W2.2 gate.
const hooks = gate.createStepLedgerGateHooks({ projectDir: () => project });
output = {};
hooks['tool.execute.before']({ tool: 'task', args: { agentName: 'pipeline-information-gate' } }, output);
assert.equal(output.error.code, 'STEP_LEDGER_VIOLATION');

const pluginHooks = plugin.createPipelineAdaptationHooks({ directory: project });
output = {};
pluginHooks['tool.execute.before']({ tool: 'task', args: { agentName: 'pipeline-information-gate' } }, output);
assert.equal(output.error.code, 'STEP_LEDGER_VIOLATION');

// Acceptance: plugin composition keeps W1.2 arm-gate and W2.2 step-gate active together.
const armProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w2-2-arm-composition-'));
writeArmPending(armProject, '/pipeline feature criar tela', new Date().toISOString());
const composedHooks = plugin.createPipelineAdaptationHooks({ directory: armProject });
output = {};
composedHooks['tool.execute.before']({ tool: 'edit', args: { filePath: path.join(armProject, 'src', 'x.js') } }, output);
assert.equal(output.error.code, 'PIPELINE_NOT_ARMED');

assert.equal(typeof opencodeIndex.createStepLedgerGateHooks, 'function');

console.log('step ledger gate OK');
