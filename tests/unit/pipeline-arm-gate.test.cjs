'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeArmPending, markerPath } = require('../../src/lib/pipeline-arm.cjs');
const gate = require('../../src/opencode/pipeline-arm-gate.cjs');
const opencodeIndex = require('../../src/opencode/index.cjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function sentinel(runId, active) {
  return {
    schemaVersion: 'SENTINEL_STATE/v1',
    runId,
    currentPhase: 'phase_0_to_1',
    checkpoints: {},
    blocked: false,
    stopRuleTriggered: false,
    lastValidEventId: null,
    updatedAt: new Date().toISOString(),
    pipeline_active: active,
  };
}

const project = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w1-2-arm-gate-'));
writeArmPending(project, '/pipeline-orchestrator:feature criar tela', new Date().toISOString());

assert.equal(gate.resolveArmTtlMs(), 30 * 60 * 1000);
process.env.PIPELINE_ARM_TTL_MS = '10';
assert.equal(gate.resolveArmTtlMs(), 30 * 60 * 1000);
process.env.PIPELINE_ARM_TTL_MS = '1000';
assert.equal(gate.resolveArmTtlMs(), 1000);
delete process.env.PIPELINE_ARM_TTL_MS;

assert.equal(gate.readArmPending(project).workflow, 'FULL/Feature');
assert.equal(gate.decideArmGate({ armPending: false, toolName: 'edit' }).decision, 'allow');
assert.equal(gate.decideArmGate({ armPending: true, runActive: true, toolName: 'edit' }).decision, 'allow');
assert.equal(gate.decideArmGate({ armPending: true, runActive: false, toolName: 'read' }).decision, 'allow');
assert.equal(gate.decideArmGate({ armPending: true, runActive: false, toolName: 'task', pipelineAligned: true }).decision, 'allow');

let decision = gate.decideArmGate({ armPending: true, runActive: false, toolName: 'edit', workflow: 'FULL/Feature' });
assert.equal(decision.decision, 'block');
assert.equal(decision.code, 'PIPELINE_NOT_ARMED');
assert.match(decision.reason, /PIPELINE_NOT_ARMED/);

process.env.PIPELINE_ARM_ENFORCEMENT = 'warn';
decision = gate.decideArmGate({ armPending: true, runActive: false, toolName: 'edit' });
delete process.env.PIPELINE_ARM_ENFORCEMENT;
assert.equal(decision.decision, 'block');
assert.equal(decision.code, 'PIPELINE_NOT_ARMED');

let output = {};
gate.handleToolExecuteBefore({ cwd: project, tool: 'edit', args: { filePath: path.join(project, 'src', 'x.js') } }, output);
assert.equal(output.error.code, 'PIPELINE_NOT_ARMED');
assert.match(output.error.reason, /NENHUM run foi armado/);

output = {};
gate.handleToolExecuteBefore({ cwd: project, tool: 'read', args: { filePath: path.join(project, 'src', 'x.js') } }, output);
assert.equal(output.error, undefined);

output = {};
gate.handleToolExecuteBefore({ cwd: project, tool: 'write', args: { filePath: path.join(project, '.pipeline', 'active-run.json') } }, output);
assert.equal(output.error, undefined);

output = {};
gate.handleToolExecuteBefore({ cwd: project, tool: 'task', args: { agentName: 'pipeline-run-orchestrator' } }, output);
assert.equal(output.error, undefined);

output = {};
gate.handleToolExecuteBefore({ cwd: project, tool: 'customTool', args: { filePath: path.join(project, '.pipeline', 'active-run.json') } }, output);
assert.equal(output.error.code, 'PIPELINE_NOT_ARMED');

output = {};
gate.handleToolExecuteBefore({ cwd: project, tool: 'newWriteTool', args: {} }, output);
assert.equal(output.error.code, 'PIPELINE_NOT_ARMED');

output = {};
gate.handleToolExecuteBefore({ cwd: project, tool: 'write', args: { filePath: path.join(project, 'pipeline-runs', 'run.log') } }, output);
assert.equal(output.error.code, 'PIPELINE_NOT_ARMED');

output = {};
gate.handleToolExecuteBefore({ cwd: project, tool: 'write', args: { filePath: path.join(project, '.opencode', 'plans', 'plan.md') } }, output);
assert.equal(output.error.code, 'PIPELINE_NOT_ARMED');

output = {};
gate.handleToolExecuteBefore({ cwd: project, tool: 'task', args: { subagent_type: 'pipeline-run-orchestrator' } }, output);
assert.equal(output.error.code, 'PIPELINE_NOT_ARMED');

const hookBlockedProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w1-2-arm-hook-blocked-'));
writeArmPending(hookBlockedProject, '/pipeline criar', new Date().toISOString());
const hooks = gate.createPipelineArmGateHooks({ projectDir: () => hookBlockedProject, audit: () => {} });
output = {};
hooks['tool.execute.before']({ tool: 'edit', args: { filePath: path.join(hookBlockedProject, 'src', 'x.js') } }, output);
assert.equal(output.error.code, 'PIPELINE_NOT_ARMED');

assert.equal(typeof opencodeIndex.createPipelineArmGateHooks, 'function');

const activeRunDir = path.join(project, '.pipeline', 'docs', 'Pre-feature-action', 'run-active');
writeJson(path.join(activeRunDir, 'sentinel-state.json'), sentinel('run-active', true));
writeJson(path.join(project, '.pipeline', 'active-run.json'), { pipeline_doc_path: activeRunDir });
output = {};
gate.handleToolExecuteBefore({ cwd: project, tool: 'edit', args: { filePath: path.join(project, 'src', 'x.js') } }, output);
assert.equal(output.error, undefined);

const expiredProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w1-2-arm-expired-'));
writeArmPending(expiredProject, '/pipeline criar', new Date(Date.now() - 31 * 60 * 1000).toISOString());
assert.equal(gate.readArmPending(expiredProject), null);

const malformedProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w1-2-arm-malformed-'));
fs.mkdirSync(path.join(malformedProject, '.pipeline'), { recursive: true });
fs.writeFileSync(path.join(malformedProject, '.pipeline', 'pipeline-arm-pending.json'), '{bad json');
output = {};
gate.handleToolExecuteBefore({ cwd: malformedProject, tool: 'edit', args: { filePath: path.join(malformedProject, 'src', 'x.js') } }, output);
assert.equal(output.error.code, 'PIPELINE_NOT_ARMED');

const unreadableMarkerProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w1-2-arm-unreadable-'));
fs.mkdirSync(path.join(unreadableMarkerProject, '.pipeline', 'pipeline-arm-pending.json'), { recursive: true });
output = {};
gate.handleToolExecuteBefore({ cwd: unreadableMarkerProject, tool: 'edit', args: { filePath: path.join(unreadableMarkerProject, 'src', 'x.js') } }, output);
assert.equal(output.error.code, 'PIPELINE_NOT_ARMED');

const statErrorProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w1-2-arm-stat-error-'));
writeArmPending(statErrorProject, '/pipeline criar', new Date().toISOString());
const originalStatSync = fs.statSync;
fs.statSync = function patchedStatSync(filePath, ...rest) {
  if (String(filePath).endsWith('pipeline-arm-pending.json')) {
    const err = new Error('access denied');
    err.code = 'EACCES';
    throw err;
  }
  return originalStatSync.call(this, filePath, ...rest);
};
try {
  output = {};
  gate.handleToolExecuteBefore({ cwd: statErrorProject, tool: 'edit', args: { filePath: path.join(statErrorProject, 'src', 'x.js') } }, output);
  assert.equal(output.error.code, 'PIPELINE_NOT_ARMED');
} finally {
  fs.statSync = originalStatSync;
}

const fallbackOnlyProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w1-2-arm-fallback-'));
writeArmPending(fallbackOnlyProject, '/pipeline criar', new Date().toISOString());
const fallbackRunDir = path.join(fallbackOnlyProject, '.pipeline', 'docs', 'Pre-feature-action', 'fallback-run');
writeJson(path.join(fallbackRunDir, 'sentinel-state.json'), sentinel('fallback-run', true));
output = {};
gate.handleToolExecuteBefore({ cwd: fallbackOnlyProject, tool: 'edit', args: { filePath: path.join(fallbackOnlyProject, 'src', 'x.js') } }, output);
assert.equal(output.error.code, 'PIPELINE_NOT_ARMED');

const escapedProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w1-2-arm-escaped-'));
const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w1-2-arm-outside-'));
fs.symlinkSync(outsideDir, path.join(escapedProject, '.pipeline'), process.platform === 'win32' ? 'junction' : 'dir');
writeJson(path.join(outsideDir, 'pipeline-arm-pending.json'), { requested_at: new Date().toISOString(), workflow: 'FULL/Feature' });
assert.equal(gate.readArmPending(escapedProject), null);

const readHooks = gate.createPipelineArmGateHooks({ projectDir: () => project, audit: () => {} });
output = {};
readHooks['tool.execute.before']({ tool: 'read', args: {} }, output);
assert.equal(output.error, undefined);

console.log('pipeline arm gate OK');
