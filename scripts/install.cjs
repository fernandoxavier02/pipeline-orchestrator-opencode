#!/usr/bin/env node
'use strict';

// Thin install CLI for the standalone OpenCode adaptation.
// Default: dry-run (prints the plan, writes nothing).
// --apply: copies the .opencode/ adaptation assets into the target project.
//
// Usage:
//   pipeline-orchestrator-opencode-install [--target <projectDir>] [--apply]
//
// Reuses src/install/dry-run.cjs (planInstall) so the plan stays consistent
// with the verified install contract. Global (~/.config/opencode) installs
// use a different layout and remain a documented manual step (see README).

const fs = require('node:fs');
const path = require('node:path');
const { planInstall, ADAPTATION_ASSETS } = require('../src/install/dry-run.cjs');

const adaptationRoot = path.resolve(__dirname, '..');
const pkg = require('../package.json');

function parseArgs(argv) {
  const args = { apply: false, target: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--target') args.target = path.resolve(argv[(i += 1)]);
    else if (a.startsWith('--target=')) args.target = path.resolve(a.slice('--target='.length));
  }
  return args;
}

function copyRecursive(source, target) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyRecursive(path.join(source, entry), path.join(target, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = planInstall({
    targetProjectRoot: args.target,
    adaptationRoot,
    requestedVersion: pkg.version,
  });

  console.log(`pipeline-orchestrator-opencode install (v${pkg.version})`);
  console.log(`target project : ${args.target}`);
  console.log(`mode           : ${args.apply ? 'APPLY' : 'DRY-RUN (use --apply to write)'}`);
  if (plan.replacementRequiresConfirmation) {
    console.log(`note           : existing install v${plan.existingVersion} will be replaced`);
  }
  for (const op of plan.operations) {
    console.log(`  [${op.action.toUpperCase()}] ${op.relativePath}`);
    if (op.action === 'refuse') {
      console.error(`  REFUSED: ${op.reason}`);
      process.exit(1);
    }
  }

  if (!args.apply) {
    console.log('Dry-run complete. Nothing written.');
    return;
  }

  let copied = 0;
  for (const asset of ADAPTATION_ASSETS) {
    const source = path.join(adaptationRoot, asset.relativePath);
    if (!fs.existsSync(source)) continue;
    copyRecursive(source, path.join(args.target, asset.relativePath));
    copied += 1;
  }
  console.log(`Applied. ${copied} asset(s) installed into ${args.target}`);
}

main();
