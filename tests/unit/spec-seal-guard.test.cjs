'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const guard = require('../../src/opencode/spec-seal-guard.cjs');
const plugin = require('../../src/opencode/pipeline-adaptation-plugin.cjs');
const opencodeIndex = require('../../src/opencode/index.cjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function runDirWithState(state) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w5-2-spec-seal-run-'));
  writeJson(path.join(runDir, 'sentinel-state.json'), {
    schemaVersion: 'SENTINEL_STATE/v1',
    runId: 'run-spec-seal',
    currentPhase: 'phase_2_to_3',
    checkpoints: {},
    blocked: false,
    stopRuleTriggered: false,
    lastValidEventId: null,
    updatedAt: new Date().toISOString(),
    pipeline_active: true,
    workflow_key: 'Spec',
    ...state,
  });
  return runDir;
}

function bash(command) {
  return { tool: 'bash', args: { command } };
}

let output = {};
guard.handleToolExecuteBefore({ tool: 'read', args: { filePath: 'x' } }, output);
assert.equal(output.error, undefined);

output = {};
guard.handleToolExecuteBefore(bash('node scripts/other.cjs'), output);
assert.equal(output.error, undefined);

output = {};
guard.handleToolExecuteBefore(bash('node lib/run-seal.cjs --variant spec-authoring'), output);
assert.equal(output.error, undefined);

const incomplete = runDirWithState({ notes: { options: { spec_review_done: false } } });
output = {};
guard.handleToolExecuteBefore(bash(`node lib/run-seal.cjs "${incomplete}" --variant spec-authoring`), output);
assert.equal(output.error.code, 'SPEC_AUTHORING_INCOMPLETE');
assert.equal(fs.existsSync(path.join(incomplete, 'protocol-events.jsonl')), true);

output = {};
guard.handleToolExecuteBefore(bash(`echo run-seal.cjs && node lib/run-seal.cjs "${incomplete}" --variant spec-authoring`), output);
assert.equal(output.error.code, 'SPEC_AUTHORING_INCOMPLETE');

output = {};
guard.handleToolExecuteBefore(bash(`node lib/run-seal.cjs "${incomplete}" && echo run-seal.cjs`), output);
assert.equal(output.error.code, 'SPEC_AUTHORING_INCOMPLETE');

output = {};
guard.handleToolExecuteBefore(bash(`node lib/run-seal.cjs -- "${incomplete}"`), output);
assert.equal(output.error.code, 'SPEC_AUTHORING_INCOMPLETE');

output = {};
guard.handleToolExecuteBefore(bash(`node lib/run-seal.cjs --unknown-flag "${incomplete}"`), output);
assert.equal(output.error.code, 'SPEC_AUTHORING_INCOMPLETE');

const missingNotes = runDirWithState({ notes: {} });
output = {};
guard.handleToolExecuteBefore(bash(`node lib/run-seal.cjs "${missingNotes}"`), output);
assert.equal(output.error.code, 'SPEC_AUTHORING_INCOMPLETE');

const doneObject = runDirWithState({ notes: { options: { spec_review_done: true } } });
output = {};
guard.handleToolExecuteBefore(bash(`node lib/run-seal.cjs "${doneObject}" --variant spec-authoring`), output);
assert.equal(output.error, undefined);

const doneString = runDirWithState({ notes: JSON.stringify({ options: { spec_review_done: true } }) });
output = {};
guard.handleToolExecuteBefore(bash(`node lib/run-seal.cjs "${doneString}"`), output);
assert.equal(output.error, undefined);

output = {};
guard.handleToolExecuteBefore(bash(`node lib/run-seal.cjs "${doneObject}" && node lib/run-seal.cjs "${incomplete}"`), output);
assert.equal(output.error.code, 'SPEC_AUTHORING_INCOMPLETE');

const corrupt = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w5-2-spec-seal-corrupt-'));
fs.writeFileSync(path.join(corrupt, 'sentinel-state.json'), '{bad json');
output = {};
guard.handleToolExecuteBefore(bash(`node lib/run-seal.cjs "${corrupt}"`), output);
assert.equal(output.error.code, 'SPEC_AUTHORING_STATE_UNTRUSTED');

const missingSentinel = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w5-2-spec-seal-missing-'));
output = {};
guard.handleToolExecuteBefore(bash(`node lib/run-seal.cjs "${missingSentinel}"`), output);
assert.equal(output.error.code, 'SPEC_AUTHORING_STATE_UNTRUSTED');

process.env.PIPELINE_SPEC_AUTHORING_ENFORCEMENT = 'warn';
try {
  output = {};
  guard.handleToolExecuteBefore(bash(`node lib/run-seal.cjs "${incomplete}"`), output);
  assert.equal(output.error, undefined);
  assert.equal(output.warning.code, 'SPEC_AUTHORING_INCOMPLETE');

  output = {};
  guard.handleToolExecuteBefore(bash(`node lib/run-seal.cjs "${incomplete}"`), output, { appendAudit: () => false });
  assert.equal(output.error, undefined);
  assert.equal(output.warning.auditFailed, true);
} finally {
  delete process.env.PIPELINE_SPEC_AUTHORING_ENFORCEMENT;
}

const hooks = guard.createSpecSealGuardHooks();
output = {};
hooks['tool.execute.before'](bash(`node lib/run-seal.cjs "${incomplete}"`), output);
assert.equal(output.error.code, 'SPEC_AUTHORING_INCOMPLETE');

const pluginHooks = plugin.createPipelineAdaptationHooks({ directory: fs.mkdtempSync(path.join(os.tmpdir(), 'po-w5-2-plugin-')) });
output = {};
pluginHooks['tool.execute.before'](bash(`node lib/run-seal.cjs "${incomplete}"`), output);
assert.equal(output.error.code, 'SPEC_AUTHORING_INCOMPLETE');

assert.equal(typeof opencodeIndex.createSpecSealGuardHooks, 'function');

async function assertOpenCodePluginFileRegistersSpecSeal() {
  const pluginFile = path.join(__dirname, '..', '..', '.opencode', 'plugins', 'pipeline-adaptation-plugin.js');
  const pluginModule = await import(pathToFileURL(pluginFile).href);
  const hooksFromFile = await pluginModule.default({ directory: fs.mkdtempSync(path.join(os.tmpdir(), 'po-w5-2-plugin-file-')) });
  output = {};
  hooksFromFile['tool.execute.before'](bash(`node lib/run-seal.cjs "${incomplete}"`), output);
  assert.equal(output.error.code, 'SPEC_AUTHORING_INCOMPLETE');
}

assertOpenCodePluginFileRegistersSpecSeal()
  .then(() => console.log('spec seal guard OK'))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
