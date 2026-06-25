'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { RunDirectory, slugify } = require('../../src/lib/run-directory.cjs');
const { readVerifiedState } = require('../../src/lib/sentinel-state-signer.cjs');
const { findActiveSentinelState } = require('../../src/state/sentinel-state-inspector.cjs');

const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'po-run-directory-'));
const runsRoot = path.join(projectRoot, 'pipeline-runs');

assert.equal(slugify('Criar integração OpenCode com TOKEN=abc123'), 'criar-integracao-opencode-com-token');
assert.equal(slugify(''), 'run');

const run = RunDirectory.allocate(runsRoot, 'Criar integração OpenCode com token=abc123 sk-abc1234567890 ghp_abc1234567890 glpat-abc1234567890 npm_abc1234567890 ASIA1234567890ABCDEF AIza12345678901234567890');

assert.match(run.runId, /^001-[a-z0-9]+-[a-z0-9-]+$/);
assert.equal(run.absPath, path.join(runsRoot, run.runId));
assert.equal(process.env.PIPELINE_RUN_ID, run.runId);

for (const dirName of ['00-brainstorm', '01-spec', '02-validations', '03-execution', 'attachments']) {
  assert.equal(fs.existsSync(path.join(run.absPath, dirName)), true);
}

const manifest = JSON.parse(fs.readFileSync(path.join(run.absPath, 'manifest.yaml'), 'utf8'));
assert.equal(manifest.run_id, run.runId);
assert.equal(manifest.status, 'ready');
assert.equal(manifest.phase, 0);
assert.equal(manifest.type, 'Unknown');
assert.equal(manifest.complexity, 'unknown');
assert.match(manifest.notes.prompt, /token=REDACTED/);
assert.doesNotMatch(manifest.notes.prompt, /sk-abc1234567890|ghp_abc1234567890|glpat-abc1234567890|npm_abc1234567890|ASIA1234567890ABCDEF|AIza12345678901234567890/);

const activePointer = JSON.parse(fs.readFileSync(path.join(projectRoot, '.pipeline', 'active-run.json'), 'utf8'));
assert.equal(activePointer.run_id, run.runId);
assert.equal(activePointer.pipeline_doc_path, run.absPath);
assert.match(activePointer.updated_at, /^\d{4}-\d{2}-\d{2}T/);

const { state, verification } = readVerifiedState(path.join(run.absPath, 'sentinel-state.json'));
assert.equal(verification.valid, true);
assert.equal(state.schemaVersion, 'SENTINEL_STATE/v1');
assert.equal(state.runId, run.runId);
assert.equal(state.currentPhase, 'phase_0');
assert.equal(state.pipeline_active, true);
assert.equal(state.type, 'Unknown');
assert.equal(state.complexity, 'unknown');

const activeState = findActiveSentinelState(projectRoot);
assert.equal(activeState.runId, run.runId);
assert.equal(activeState.pipeline_active, true);

fs.rmSync(path.join(projectRoot, '.pipeline', 'active-run.json'), { force: true });
const envState = findActiveSentinelState(projectRoot);
assert.equal(envState.runId, run.runId);

delete process.env.PIPELINE_RUN_ID;
const fallbackState = findActiveSentinelState(projectRoot);
assert.equal(fallbackState.runId, run.runId);

const originalRandomBytes = crypto.randomBytes;
const fixedNow = Date.now();
const collisionId = `${fixedNow.toString(36)}01020304`;
let collisionCalls = 0;
const originalMkdirSync = fs.mkdirSync;
crypto.randomBytes = () => {
  collisionCalls += 1;
  return Buffer.from(collisionCalls === 1 ? '01020304' : '05060708', 'hex');
};
const originalDateNow = Date.now;
Date.now = () => fixedNow;
fs.mkdirSync = (dirPath, options) => {
  if (dirPath === path.join(runsRoot, `002-${collisionId}-collision-test`)) {
    const err = new Error('exists');
    err.code = 'EEXIST';
    throw err;
  }
  return originalMkdirSync(dirPath, options);
};
try {
  const collisionRun = RunDirectory.allocate(runsRoot, 'collision test');
  assert.equal(collisionRun.runId, `002-${fixedNow.toString(36)}05060708-collision-test`);
} finally {
  Date.now = originalDateNow;
  crypto.randomBytes = originalRandomBytes;
  fs.mkdirSync = originalMkdirSync;
}

const second = RunDirectory.allocate(runsRoot, 'Outra execução');
assert.match(second.runId, /^003-/);
assert.notEqual(second.runId, run.runId);

assert.throws(() => RunDirectory.allocate('relative', 'x'), /rootDir must be absolute/);
const wrongRoot = path.join(projectRoot, 'runs');
assert.throws(() => RunDirectory.allocate(wrongRoot, 'x'), /pipeline-runs/);

console.log('run directory OK');
