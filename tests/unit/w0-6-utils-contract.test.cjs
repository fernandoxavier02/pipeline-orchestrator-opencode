'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const lock = require('../../src/lib/exclusive-lock.cjs');
const entryPoints = require('../../src/lib/entry-points.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w0-6-'));
const targetPath = path.join(tmp, 'events.jsonl');

assert.equal(lock.DEFAULT_MAX_ATTEMPTS, 150);
assert.equal(lock.DEFAULT_RETRY_MS, 25);
assert.equal(lock.DEFAULT_STALE_MS, 10000);
assert.equal(typeof lock.busyWait, 'function');

let release = lock.acquire(`${targetPath}.lock`, { maxAttempts: 1, retryMs: 1, staleMs: 1000 });
assert.equal(fs.existsSync(`${targetPath}.lock`), true);
release();
release();
assert.equal(fs.existsSync(`${targetPath}.lock`), false);

const value = lock.withLock(targetPath, () => {
  assert.equal(fs.existsSync(`${targetPath}.lock`), true);
  return 42;
}, { maxAttempts: 1, retryMs: 1, staleMs: 1000 });
assert.equal(value, 42);
assert.equal(fs.existsSync(`${targetPath}.lock`), false);

fs.writeFileSync(`${targetPath}.lock`, 'stale');
const old = new Date(Date.now() - 60_000);
fs.utimesSync(`${targetPath}.lock`, old, old);
release = lock.acquire(`${targetPath}.lock`, { maxAttempts: 2, retryMs: 1, staleMs: 1 });
release();
assert.equal(fs.existsSync(`${targetPath}.lock`), false);

assert.match(String(entryPoints.PREFIX_RE), /pipeline-orchestrator/);
assert.equal(entryPoints.detectEntryPoint('/pipeline-orchestrator:pipeline do it'), 'pipeline');
assert.equal(entryPoints.detectEntryPoint('  /PIPELINE-ORCHESTRATOR:BUGFIX-heavy fix it'), 'bugfix-heavy');
assert.equal(entryPoints.detectEntryPoint('/pipeline-orchestrator:userstory write story'), 'user-story');
assert.equal(entryPoints.detectEntryPoint('/pipeline-orchestrator:ux check flow'), 'ux-sim');
assert.equal(entryPoints.detectEntryPoint('/pipeline-orchestrator:bugfix-foo nope'), null);
assert.equal(entryPoints.detectEntryPoint('/not-pipeline:pipeline'), null);
assert.equal(entryPoints.isPipelineEntryPoint('/pipeline-orchestrator:spec-audit-only review'), true);

const names = entryPoints.entryPointNames();
for (const name of ['pipeline', 'bugfix-light', 'feature-heavy', 'user-story-heavy', 'ux-sim-light', 'spec-audit-only', 'review', 'userstory', 'ux']) {
  assert.equal(names.includes(name), true);
}

const customRegistry = path.join(tmp, 'entry-points.json');
fs.writeFileSync(customRegistry, JSON.stringify({ entry_points: ['custom'], legacy_aliases: { oldcustom: 'custom' } }));
let registry = entryPoints.loadRegistry({ path: customRegistry });
assert.equal(registry.names.has('custom'), true);
assert.equal(registry.names.has('oldcustom'), true);
assert.equal(registry.aliases.oldcustom, 'custom');

const brokenRegistry = path.join(tmp, 'broken-entry-points.json');
fs.writeFileSync(brokenRegistry, '{bad json');
registry = entryPoints.loadRegistry({ path: brokenRegistry });
assert.equal(registry.names.has('bugfix-heavy'), true);
assert.equal(registry.aliases.userstory, 'user-story');

const malformedRegistry = path.join(tmp, 'malformed-entry-points.json');
fs.writeFileSync(malformedRegistry, JSON.stringify({ entry_points: 'pipeline', legacy_aliases: [] }));
registry = entryPoints.loadRegistry({ path: malformedRegistry });
assert.equal(registry.names.has('feature-heavy'), true);
assert.equal(registry.aliases.ux, 'ux-sim');

const registryJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'references', 'entry-points.json'), 'utf8'));
assert.equal(registryJson.entry_points.includes('pipeline'), true);
assert.equal(registryJson.legacy_aliases.ux, 'ux-sim');

console.log('w0.6 utils contract OK');
