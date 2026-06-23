'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const hook = require('../../src/opencode/scope-lock-hook.cjs');
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
    runId: 'run-scope-lock',
    currentPhase: 'phase_1_to_2',
    checkpoints: {},
    blocked: false,
    stopRuleTriggered: false,
    lastValidEventId: null,
    updatedAt: new Date().toISOString(),
    pipeline_active: true,
    workflow_key: 'FULL',
    ...overrides,
  };
}

function project() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'po-w5-1-scope-lock-'));
}

function writeActiveContract(projectDir, contract, overrides = {}) {
  writeJson(path.join(projectDir, '.pipeline', 'sessions', 'active.lock'), {
    session_id: 'session-scope-lock',
    status: 'active',
    expires_at: Date.now() + 60_000,
    created_at: Date.now(),
    last_seen_at: Date.now(),
    active_change_contract: contract,
    ...overrides,
  });
}

function writeRun(projectDir, state, rows) {
  const runDir = path.join(projectDir, '.pipeline', 'docs', 'Pre-refactor-action', state.runId || 'run-scope-lock');
  writeJson(path.join(runDir, 'sentinel-state.json'), state);
  writeJson(path.join(projectDir, '.pipeline', 'active-run.json'), { pipeline_doc_path: runDir });
  if (Array.isArray(rows)) appendJsonl(path.join(runDir, 'gate-decisions.jsonl'), rows);
  return runDir;
}

// Acceptance: no active contract and no refactor run are permissive.
let p = project();
let output = {};
hook.handleToolExecuteBefore({ cwd: p, tool: 'edit', args: { filePath: path.join(p, 'src', 'free.js') } }, output);
assert.equal(output.error, undefined);

// Acceptance: forbidden_files denylist wins over allowlist.
p = project();
writeActiveContract(p, {
  allowed_files: ['src/**'],
  forbidden_files: ['src/secrets/**'],
});
output = {};
hook.handleToolExecuteBefore({ cwd: p, tool: 'edit', args: { filePath: path.join(p, 'src', 'secrets', 'token.js') } }, output);
assert.equal(output.error.code, 'SCOPE_LOCK_FORBIDDEN');

// Acceptance: populated allowlist blocks writes outside allowed_files / allowed_new_files.
output = {};
hook.handleToolExecuteBefore({ cwd: p, tool: 'write', args: { filePath: path.join(p, 'src', 'allowed.js') } }, output);
assert.equal(output.error.code, 'SCOPE_LOCK_OUTSIDE_ALLOWED');

fs.mkdirSync(path.join(p, 'src'), { recursive: true });
fs.writeFileSync(path.join(p, 'src', 'allowed.js'), 'old');
output = {};
hook.handleToolExecuteBefore({ cwd: p, tool: 'edit', args: { filePath: path.join(p, 'src', 'allowed.js') } }, output);
assert.equal(output.error, undefined);

output = {};
hook.handleToolExecuteBefore({ cwd: p, tool: 'write', args: { filePath: path.join(p, 'tests', 'outside.test.js') } }, output);
assert.equal(output.error.code, 'SCOPE_LOCK_OUTSIDE_ALLOWED');

p = project();
writeActiveContract(p, { allowed_new_files: ['tests/**'] });
output = {};
hook.handleToolExecuteBefore({ cwd: p, tool: 'write', args: { filePath: path.join(p, 'tests', 'new.test.js') } }, output);
assert.equal(output.error, undefined);

fs.mkdirSync(path.join(p, 'tests'), { recursive: true });
fs.writeFileSync(path.join(p, 'tests', 'existing.test.js'), 'old');
output = {};
hook.handleToolExecuteBefore({ cwd: p, tool: 'edit', args: { filePath: path.join(p, 'tests', 'existing.test.js') } }, output);
assert.equal(output.error.code, 'SCOPE_LOCK_OUTSIDE_ALLOWED');

// Acceptance: real path containment blocks symlink/junction escapes when the OS supports them.
const external = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w5-1-external-'));
p = project();
writeActiveContract(p, { allowed_files: ['src/**'] });
fs.mkdirSync(path.join(p, 'src'), { recursive: true });
let symlinkCreated = false;
try {
  fs.symlinkSync(external, path.join(p, 'src', 'outside-link'), 'junction');
  symlinkCreated = true;
} catch (_) {
  // Windows may require privileges for symlink/junction creation in some shells.
}
if (symlinkCreated) {
  output = {};
  hook.handleToolExecuteBefore({ cwd: p, tool: 'write', args: { filePath: path.join(p, 'src', 'outside-link', 'escape.js') } }, output);
  assert.equal(output.error.code, 'SCOPE_LOCK_PATH_OUTSIDE_PROJECT');
}

// Acceptance: stale or malformed session locks are not trusted as scope contracts.
p = project();
writeActiveContract(p, { allowed_files: ['src/**'] }, { session_id: undefined });
output = {};
hook.handleToolExecuteBefore({ cwd: p, tool: 'write', args: { filePath: path.join(p, 'docs', 'legacy.md') } }, output);
assert.equal(output.error, undefined);

p = project();
writeActiveContract(p, { allowed_files: ['src/**'] }, { last_seen_at: Date.now() - 11 * 60 * 1000 });
output = {};
hook.handleToolExecuteBefore({ cwd: p, tool: 'write', args: { filePath: path.join(p, 'docs', 'stale.md') } }, output);
assert.equal(output.error, undefined);

// Acceptance: bootstrap contracts are explicitly permissive.
p = project();
writeActiveContract(p, { bootstrap: { active: true }, allowed_files: ['src/only.js'] });
output = {};
hook.handleToolExecuteBefore({ cwd: p, tool: 'edit', args: { filePath: path.join(p, 'elsewhere.js') } }, output);
assert.equal(output.error, undefined);

// Acceptance: refactor runs block production writes until REFACTOR_SCOPE_LOCK is logged.
p = project();
writeRun(p, sentinel({ variant: 'refactor-heavy' }), []);
output = {};
hook.handleToolExecuteBefore({ cwd: p, tool: 'edit', args: { filePath: path.join(p, 'src', 'refactor.js') } }, output);
assert.equal(output.error.code, 'REFACTOR_SCOPE_LOCK_MISSING');

output = {};
hook.handleToolExecuteBefore({ cwd: p, tool: 'edit', args: { filePath: path.join(p, '.pipeline', 'notes.md') } }, output);
assert.equal(output.error, undefined);

p = project();
writeRun(p, sentinel({ variant: 'refactor-heavy' }), [{ gate: 'REFACTOR_SCOPE_LOCK', run_id: 'run-scope-lock' }]);
output = {};
hook.handleToolExecuteBefore({ cwd: p, tool: 'edit', args: { filePath: path.join(p, 'src', 'refactor.js') } }, output);
assert.equal(output.error, undefined);

// Acceptance: stale gate evidence from a different run does not satisfy refactor scope lock.
p = project();
writeRun(p, sentinel({ variant: 'refactor-heavy' }), [{ gate: 'REFACTOR_SCOPE_LOCK', run_id: 'other-run' }]);
output = {};
hook.handleToolExecuteBefore({ cwd: p, tool: 'edit', args: { filePath: path.join(p, 'src', 'refactor.js') } }, output);
assert.equal(output.error.code, 'REFACTOR_SCOPE_LOCK_MISSING');

p = project();
writeRun(p, sentinel({ variant: 'refactor-heavy' }), [{ gate: 'REFACTOR_SCOPE_LOCK' }]);
output = {};
hook.handleToolExecuteBefore({ cwd: p, tool: 'edit', args: { filePath: path.join(p, 'src', 'refactor.js') } }, output);
assert.equal(output.error.code, 'REFACTOR_SCOPE_LOCK_MISSING');

// Acceptance: hook factory, plugin composition, and index expose W5.1.
p = project();
writeActiveContract(p, { allowed_files: ['src/**'] });
const hooks = hook.createScopeLockHooks({ projectDir: () => p });
output = {};
hooks['tool.execute.before']({ tool: 'write', args: { filePath: path.join(p, 'docs', 'bad.md') } }, output);
assert.equal(output.error.code, 'SCOPE_LOCK_OUTSIDE_ALLOWED');

const pluginHooks = plugin.createPipelineAdaptationHooks({ directory: p });
output = {};
pluginHooks['tool.execute.before']({ tool: 'write', args: { filePath: path.join(p, 'docs', 'bad.md') } }, output);
assert.equal(output.error.code, 'SCOPE_LOCK_OUTSIDE_ALLOWED');

assert.equal(typeof opencodeIndex.createScopeLockHooks, 'function');

async function assertOpenCodePluginFileRegistersScopeLock() {
  const pluginFile = path.join(__dirname, '..', '..', '.opencode', 'plugins', 'pipeline-adaptation-plugin.js');
  const pluginModule = await import(pathToFileURL(pluginFile).href);
  const actualPluginProject = project();
  writeActiveContract(actualPluginProject, { allowed_files: ['src/**'] });
  const hooksFromFile = await pluginModule.default({ directory: actualPluginProject });
  output = {};
  hooksFromFile['tool.execute.before']({ tool: 'write', args: { filePath: path.join(actualPluginProject, 'docs', 'bad.md') } }, output);
  assert.equal(output.error.code, 'SCOPE_LOCK_OUTSIDE_ALLOWED');
}

assertOpenCodePluginFileRegistersScopeLock()
  .then(() => console.log('scope lock hook OK'))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
