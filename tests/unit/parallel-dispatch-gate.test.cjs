'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const gate = require('../../src/opencode/parallel-dispatch-gate.cjs');
const plugin = require('../../src/opencode/pipeline-adaptation-plugin.cjs');
const opencodeIndex = require('../../src/opencode/index.cjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function sentinel(overrides = {}) {
  return {
    schemaVersion: 'SENTINEL_STATE/v1',
    runId: 'run-parallel-dispatch',
    currentPhase: 'phase_1_to_2',
    checkpoints: {},
    blocked: false,
    stopRuleTriggered: false,
    lastValidEventId: null,
    updatedAt: new Date().toISOString(),
    pipeline_active: true,
    workflow_key: 'FULL',
    step_ledger: ['classify', 'info-gate', 'plan', 'tdd'],
    parallel_dispatch_expected: {
      group_id: 'review-batch',
      dispatch_ids: ['pipeline-adversarial-security', 'pipeline-adversarial-quality'],
      armed_ts: new Date().toISOString(),
    },
    ...overrides,
  };
}

function projectWithState(state) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w5-3-parallel-dispatch-'));
  const runDir = path.join(project, '.pipeline', 'docs', 'Pre-feature-action', state.runId || 'run-parallel-dispatch');
  writeJson(path.join(runDir, 'sentinel-state.json'), state);
  writeJson(path.join(project, '.pipeline', 'active-run.json'), { pipeline_doc_path: runDir });
  return { project, runDir };
}

function task(agentName) {
  return { tool: 'task', args: { agentName, prompt: `dispatch ${agentName}` } };
}

let output = {};
gate.handleToolExecuteBefore({ cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'po-w5-3-no-state-')), tool: 'task', args: { agentName: 'pipeline-implementer' } }, output);
assert.equal(output.error, undefined);

output = {};
gate.handleToolExecuteBefore({ tool: 'bash', args: { command: 'npm test' } }, output);
assert.equal(output.error, undefined);

const governed = projectWithState(sentinel());

// Acceptance: armed group members are allowed without warning.
output = {};
gate.handleToolExecuteBefore({ cwd: governed.project, ...task('pipeline-adversarial-security') }, output);
assert.equal(output.error, undefined);
assert.equal(output.warning, undefined);

// Acceptance: out-of-group dispatch warns by default and writes audit evidence.
output = {};
gate.handleToolExecuteBefore({ cwd: governed.project, ...task('pipeline-implementer') }, output);
assert.equal(output.error, undefined);
assert.equal(output.warning.code, 'PARALLEL_DISPATCH_VIOLATION');
const events = readJsonl(path.join(governed.runDir, 'protocol-events.jsonl'));
assert.equal(events.at(-1).event, 'PARALLEL_DISPATCH_VIOLATION');
assert.equal(events.at(-1).decided_by, 'parallel-dispatch-gate');

// Acceptance: hard deny is suppressed for schema-only local state.
process.env.PIPELINE_PARALLEL_ENFORCEMENT = 'deny';
try {
  output = {};
  gate.handleToolExecuteBefore({ cwd: governed.project, ...task('pipeline-implementer') }, output);
  assert.equal(output.error, undefined);
  assert.equal(output.warning.code, 'PARALLEL_DISPATCH_VIOLATION');
  assert.equal(output.warning.denySuppressed, true);
} finally {
  delete process.env.PIPELINE_PARALLEL_ENFORCEMENT;
}

// Acceptance: hard deny only happens under explicit opt-in plus strong state trust.
process.env.PIPELINE_PARALLEL_ENFORCEMENT = 'deny';
try {
  output = {};
  gate.handleToolExecuteBefore({ cwd: governed.project, ...task('pipeline-implementer') }, output, { stateStronglyTrusted: true });
  assert.equal(output.error.code, 'PARALLEL_DISPATCH_VIOLATION');
} finally {
  delete process.env.PIPELINE_PARALLEL_ENFORCEMENT;
}

// Acceptance: malformed marker is audit-only fail-open.
const malformed = projectWithState(sentinel({ parallel_dispatch_expected: { group_id: 'bad', dispatch_ids: 'not-array', armed_ts: new Date().toISOString() } }));
output = {};
gate.handleToolExecuteBefore({ cwd: malformed.project, ...task('pipeline-implementer') }, output);
assert.equal(output.error, undefined);
assert.equal(output.warning.code, 'PARALLEL_DISPATCH_MALFORMED');

// Acceptance: invalid armed_ts is fail-open because serial violation cannot be proven.
const invalidTs = projectWithState(sentinel({ parallel_dispatch_expected: { group_id: 'bad-ts', dispatch_ids: ['pipeline-validator'], armed_ts: 'tomorrow' } }));
output = {};
gate.handleToolExecuteBefore({ cwd: invalidTs.project, ...task('pipeline-implementer') }, output);
assert.equal(output.error, undefined);
assert.equal(output.warning, undefined);

// Acceptance: inactive runs are not governed.
const inactive = projectWithState(sentinel({ pipeline_active: false }));
output = {};
gate.handleToolExecuteBefore({ cwd: inactive.project, ...task('pipeline-implementer') }, output);
assert.equal(output.error, undefined);
assert.equal(output.warning, undefined);

// Acceptance: corrupt state fails open for this efficiency-only gate.
const corruptProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w5-3-parallel-corrupt-'));
const corruptRunDir = path.join(corruptProject, '.pipeline', 'docs', 'Pre-feature-action', 'run-corrupt');
fs.mkdirSync(corruptRunDir, { recursive: true });
fs.writeFileSync(path.join(corruptRunDir, 'sentinel-state.json'), '{bad json');
writeJson(path.join(corruptProject, '.pipeline', 'active-run.json'), { pipeline_doc_path: corruptRunDir });
output = {};
gate.handleToolExecuteBefore({ cwd: corruptProject, ...task('pipeline-implementer') }, output);
assert.equal(output.error, undefined);
assert.equal(output.warning, undefined);

// Acceptance: hook factory, plugin composition, and index expose W5.3.
const hooks = gate.createParallelDispatchGateHooks({ projectDir: () => governed.project });
output = {};
hooks['tool.execute.before'](task('pipeline-implementer'), output);
assert.equal(output.warning.code, 'PARALLEL_DISPATCH_VIOLATION');

output = { args: { agentName: 'pipeline-implementer', prompt: 'mutated OpenCode args' } };
hooks['tool.execute.before'](task('pipeline-adversarial-security'), output);
assert.equal(output.warning.code, 'PARALLEL_DISPATCH_VIOLATION');

const pluginHooks = plugin.createPipelineAdaptationHooks({ directory: governed.project });
output = {};
pluginHooks['tool.execute.before'](task('pipeline-implementer'), output);
assert.equal(output.warning.code, 'PARALLEL_DISPATCH_VIOLATION');

assert.equal(typeof opencodeIndex.createParallelDispatchGateHooks, 'function');

async function assertOpenCodePluginFileRegistersParallelGate() {
  const pluginFile = path.join(__dirname, '..', '..', '.opencode', 'plugins', 'pipeline-adaptation-plugin.js');
  const pluginModule = await import(pathToFileURL(pluginFile).href);
  const hooksFromFile = await pluginModule.default({ directory: governed.project });
  output = {};
  hooksFromFile['tool.execute.before'](task('pipeline-implementer'), output);
  assert.equal(output.warning.code, 'PARALLEL_DISPATCH_VIOLATION');
}

assertOpenCodePluginFileRegistersParallelGate()
  .then(() => console.log('parallel dispatch gate OK'))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
