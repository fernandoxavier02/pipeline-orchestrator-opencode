'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const arm = require('../../src/lib/pipeline-arm.cjs');

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w1-1-arm-'));
const nowIso = '2026-06-22T12:00:00.000Z';
const prompt = '/pipeline-orchestrator:feature --heavy criar nova tela\ncom detalhes extras';

assert.equal(arm.markerPath(cwd), path.join(cwd, '.pipeline', 'pipeline-arm-pending.json'));
assert.equal(arm.writeArmPending('', prompt, nowIso), null);
assert.equal(arm.writeArmPending(cwd, 'pedido comum sem pipeline', nowIso), null);
assert.equal(fs.existsSync(arm.markerPath(cwd)), false);

const marker = arm.writeArmPending(cwd, prompt, nowIso);
assert.deepEqual(marker, {
  requested_at: nowIso,
  workflow: 'FULL/Feature',
  mode: 'FULL',
  type: 'Feature',
  variant: 'heavy',
  complexity: null,
  source: 'kw:feature',
  prompt_excerpt: '/pipeline-orchestrator:feature --heavy criar nova tela com detalhes extras',
});

const persisted = JSON.parse(fs.readFileSync(arm.markerPath(cwd), 'utf8'));
assert.deepEqual(persisted, marker);
assert.equal(Object.prototype.hasOwnProperty.call(persisted, '__signature'), false);

const longPrompt = `/pipeline ${'x'.repeat(250)}`;
arm.writeArmPending(cwd, longPrompt, nowIso);
const longPersisted = JSON.parse(fs.readFileSync(arm.markerPath(cwd), 'utf8'));
assert.equal(longPersisted.prompt_excerpt.length, 200);
assert.equal(longPersisted.workflow, 'FULL');

const secretPrompt = `/pipeline token=secret-value ${'x'.repeat(250)}`;
arm.writeArmPending(cwd, secretPrompt, nowIso);
const secretPersisted = JSON.parse(fs.readFileSync(arm.markerPath(cwd), 'utf8'));
assert.equal(secretPersisted.prompt_excerpt.includes('secret-value'), false);
assert.equal(secretPersisted.prompt_excerpt.includes('[REDACTED_SECRET]'), true);

const staleTemp = `${arm.markerPath(cwd)}.${process.pid}.tmp`;
fs.writeFileSync(staleTemp, 'stale-temp');
arm.writeArmPending(cwd, prompt, nowIso);
assert.equal(fs.readFileSync(staleTemp, 'utf8'), 'stale-temp');
fs.unlinkSync(staleTemp);

const escapedProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w1-1-arm-escape-'));
const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w1-1-arm-outside-'));
fs.symlinkSync(outsideDir, path.join(escapedProject, '.pipeline'), process.platform === 'win32' ? 'junction' : 'dir');
fs.writeFileSync(path.join(outsideDir, 'pipeline-arm-pending.json'), 'outside-marker');
assert.throws(() => arm.writeArmPending(escapedProject, prompt, nowIso), /outside project/i);
assert.equal(arm.clearArmPending(escapedProject), false);
assert.equal(fs.readFileSync(path.join(outsideDir, 'pipeline-arm-pending.json'), 'utf8'), 'outside-marker');

assert.equal(arm.clearArmPending(cwd), true);
assert.equal(fs.existsSync(arm.markerPath(cwd)), false);
assert.equal(arm.clearArmPending(cwd), false);

console.log('pipeline arm OK');
