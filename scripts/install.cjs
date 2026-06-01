#!/usr/bin/env node
'use strict';

// Install CLI for the standalone OpenCode adaptation.
// Default: dry-run (prints the plan, writes nothing).
// --apply: copies the .opencode/ adaptation assets into the target project.
//
// Usage:
//   pipeline-orchestrator-opencode-install [--target <projectDir>] [--apply]
//
// Plan and apply are driven by the SAME filtered list (only assets that exist
// in the package source), so the dry-run never promises something --apply skips.
// Global (~/.config/opencode) installs use a different layout and remain a
// documented manual step (see README).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ADAPTATION_ASSETS } = require('../src/install/dry-run.cjs');

const adaptationRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { apply: false, target: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') {
      args.apply = true;
    } else if (a === '--target') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error('--target requires a directory path');
      }
      args.target = path.resolve(next);
      i += 1;
    } else if (a.startsWith('--target=')) {
      const value = a.slice('--target='.length);
      if (value === '') throw new Error('--target requires a directory path');
      args.target = path.resolve(value);
    }
  }
  return args;
}

// Refuse obviously dangerous targets: filesystem root, home dir, temp dir.
function assertSafeTarget(target) {
  const resolved = path.resolve(target);
  const forbidden = [
    path.parse(resolved).root,
    os.homedir(),
    os.tmpdir(),
  ].map((p) => path.resolve(p));
  if (forbidden.includes(resolved)) {
    throw new Error(`refusing to install into a protected directory: ${resolved}`);
  }
  return resolved;
}

// Returns { present, missing } partition of ADAPTATION_ASSETS by source existence.
function partitionAssets(root) {
  const present = [];
  const missing = [];
  for (const asset of ADAPTATION_ASSETS) {
    const source = path.join(root, asset.relativePath);
    (fs.existsSync(source) ? present : missing).push(asset);
  }
  return { present, missing };
}

function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Recursive copy that refuses symlinks and writes that escape `boundary`.
function copyRecursive(source, target, boundary) {
  if (!isInside(target, boundary)) {
    throw new Error(`refusing to write outside target: ${target}`);
  }
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    throw new Error(`refusing to copy symlink: ${source}`);
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyRecursive(path.join(source, entry), path.join(target, entry), boundary);
    }
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const pkg = require('../package.json');
  const target = args.apply ? assertSafeTarget(args.target) : path.resolve(args.target);
  const { present, missing } = partitionAssets(adaptationRoot);

  console.log(`pipeline-orchestrator-opencode install (v${pkg.version})`);
  console.log(`target project : ${target}`);
  console.log(`mode           : ${args.apply ? 'APPLY' : 'DRY-RUN (use --apply to write)'}`);

  for (const asset of present) {
    const exists = fs.existsSync(path.join(target, asset.relativePath));
    if (exists && asset.kind === 'file') {
      console.log(`  [REPLACE] ${asset.relativePath}  (overwrites existing file in target)`);
    } else {
      console.log(`  [${exists ? 'REPLACE' : 'CREATE'}] ${asset.relativePath}`);
    }
  }
  for (const asset of missing) {
    console.log(`  [SKIP] ${asset.relativePath}  (not shipped in this package)`);
  }

  if (!args.apply) {
    console.log('Dry-run complete. Nothing written.');
    return;
  }

  let copied = 0;
  for (const asset of present) {
    copyRecursive(
      path.join(adaptationRoot, asset.relativePath),
      path.join(target, asset.relativePath),
      target,
    );
    copied += 1;
  }
  console.log(`Applied. ${copied} of ${present.length} present asset(s) installed into ${target}.`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`install failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { parseArgs, assertSafeTarget, partitionAssets, copyRecursive, isInside };
