'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const cli = require('../../scripts/install.cjs');
const packageRoot = path.resolve(__dirname, '..', '..');

// --- parseArgs ---
assert.equal(cli.parseArgs(['--apply']).apply, true);
assert.equal(cli.parseArgs([]).apply, false);
assert.equal(cli.parseArgs(['--target', '/foo/bar']).target, path.resolve('/foo/bar'));
assert.equal(cli.parseArgs(['--target=/baz']).target, path.resolve('/baz'));
assert.throws(() => cli.parseArgs(['--target']), /requires a directory/);
assert.throws(() => cli.parseArgs(['--target', '--apply']), /requires a directory/);
assert.throws(() => cli.parseArgs(['--target=']), /requires a directory/);

// --- assertSafeTarget: refuse protected roots ---
assert.throws(() => cli.assertSafeTarget(os.homedir()), /protected/);
assert.throws(() => cli.assertSafeTarget(os.tmpdir()), /protected/);
assert.throws(() => cli.assertSafeTarget(path.parse(process.cwd()).root), /protected/);
const safeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-cli-safe-'));
assert.equal(cli.assertSafeTarget(safeDir), path.resolve(safeDir));

// --- partitionAssets: present vs missing reflects real source ---
const { present, missing } = cli.partitionAssets(packageRoot);
const presentPaths = present.map((a) => a.relativePath);
const missingPaths = missing.map((a) => a.relativePath);
assert.ok(presentPaths.includes('.opencode/agents'));
assert.ok(presentPaths.includes('.opencode/skills'));
assert.ok(presentPaths.includes('opencode.json'));
assert.ok(missingPaths.includes('.opencode/tools'), 'tools not shipped -> missing');
assert.ok(missingPaths.includes('.opencode/tests'), 'tests not shipped -> missing');
assert.ok(!presentPaths.includes('.opencode/tools'));

// --- copyRecursive: containment guard ---
{
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-src-'));
  fs.writeFileSync(path.join(src, 'f.txt'), 'data');
  const boundary = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-bnd-'));
  const outside = path.join(path.dirname(boundary), 'escape-' + path.basename(boundary), 'f.txt');
  assert.throws(() => cli.copyRecursive(path.join(src, 'f.txt'), outside, boundary), /outside target/);
  cli.copyRecursive(path.join(src, 'f.txt'), path.join(boundary, 'f.txt'), boundary);
  assert.equal(fs.readFileSync(path.join(boundary, 'f.txt'), 'utf8'), 'data');
}

// --- copyRecursive: refuse symlink (skip if the OS forbids creating one) ---
{
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-sym-'));
  const real = path.join(src, 'real.txt');
  fs.writeFileSync(real, 'data');
  const link = path.join(src, 'link.txt');
  let symlinkOk = true;
  try { fs.symlinkSync(real, link); } catch (_e) { symlinkOk = false; }
  if (symlinkOk) {
    const bnd = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-symb-'));
    assert.throws(() => cli.copyRecursive(link, path.join(bnd, 'link.txt'), bnd), /symlink/);
  } else {
    console.log('  (skip symlink-refusal: ambiente sem privilegio de symlink)');
  }
}

// --- end-to-end: --apply copies only present assets, never the missing ones ---
{
  const tgt = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-apply-'));
  const res = spawnSync(
    process.execPath,
    [path.join(packageRoot, 'scripts', 'install.cjs'), '--target', tgt, '--apply'],
    { encoding: 'utf8' },
  );
  assert.equal(res.status, 0, res.stderr);
  assert.ok(fs.existsSync(path.join(tgt, '.opencode', 'agents')), 'agents installed');
  assert.ok(fs.existsSync(path.join(tgt, 'opencode.json')), 'opencode.json installed');
  assert.equal(fs.existsSync(path.join(tgt, '.opencode', 'tools')), false, 'missing asset not created');
  assert.ok(/Applied\. \d+ of \d+ present/.test(res.stdout), res.stdout);
  // count consistency: copied === present.length
  const m = res.stdout.match(/Applied\. (\d+) of (\d+) present/);
  assert.equal(m[1], m[2], 'copied count equals present count');
}

// --- end-to-end: --apply into a protected target is refused (non-zero exit) ---
{
  const res = spawnSync(
    process.execPath,
    [path.join(packageRoot, 'scripts', 'install.cjs'), '--target', os.homedir(), '--apply'],
    { encoding: 'utf8' },
  );
  assert.equal(res.status, 1, 'refuses protected target');
  assert.ok(/protected directory/.test(res.stderr), res.stderr);
}

console.log('install cli OK');
