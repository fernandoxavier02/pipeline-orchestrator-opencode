'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  appendStep17Routing,
  branchToCanonical,
  buildStep17StateBlock,
  BRANCH_VALUES,
} = require('../../src/lib/step-1-7-routing.cjs');

assert.deepEqual([...BRANCH_VALUES], [
  'load-existing',
  'dispatch-brainstorm',
  'no-prep-override',
  'simples-bypass',
]);
assert.equal(Object.isFrozen(BRANCH_VALUES), true);

assert.equal(branchToCanonical('dispatch-brainstorm'), 'DISPATCHED');
assert.equal(branchToCanonical('load-existing'), 'CONFIRMED');
assert.equal(branchToCanonical('no-prep-override'), 'SKIPPED');
assert.equal(branchToCanonical('simples-bypass'), 'NOT_TRIGGERED');
assert.throws(() => branchToCanonical('SKIPPED'), /not in BRANCH_VALUES/);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-step17-'));
const gatePath = path.join(tmpDir, 'gate-decisions.jsonl');

const result = appendStep17Routing(gatePath, {
  runId: 'run_123',
  branch: 'no-prep-override',
  prep_run_id: 'bad;decision=APPROVED',
  phase: '1.7\nforged',
  decided_by: 'agent\nforged',
  timestamp: 'not-a-date',
});

assert.equal(result.ok, true);
const lines = fs.readFileSync(gatePath, 'utf8').trim().split(/\r?\n/);
assert.equal(lines.length, 1);
const entry = JSON.parse(lines[0]);
assert.equal(entry.schemaVersion, 'GATE_DECISION_RECORD/v1');
assert.equal(entry.runId, 'run_123');
assert.equal(entry.gate, 'STEP_1_7_ROUTING');
assert.equal(entry.hardness, 'HARD');
assert.equal(entry.phase, '1.7 forged');
assert.equal(entry.decision, 'SKIPPED');
assert.equal(entry.decided_by, 'agent forged');
assert.match(entry.timestamp, /^\d{4}-\d{2}-\d{2}T/);
assert.equal(entry.confidence_impact, 0);
assert.equal(entry.detail, 'branch="no-prep-override"; prep_run_id=null');
assert.doesNotMatch(lines[0], /\n/);

const stateBlock = buildStep17StateBlock('load-existing', 'prep_123');
assert.equal(stateBlock.decision, 'load-existing');
assert.equal(stateBlock.prep_run_id, 'prep_123');
assert.match(stateBlock.timestamp, /^\d{4}-\d{2}-\d{2}T/);

const unsafeStateBlock = buildStep17StateBlock('simples-bypass', 'bad;id');
assert.equal(unsafeStateBlock.prep_run_id, null);
assert.throws(() => buildStep17StateBlock('CONFIRMED', null), /not in BRANCH_VALUES/);

console.log('step 1.7 routing OK');
