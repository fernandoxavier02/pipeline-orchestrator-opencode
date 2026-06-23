'use strict';

const assert = require('node:assert/strict');

const contract = require('../../src/lib/contracts/gate-decision.cjs');

assert.equal(contract.SCHEMA_VERSION, '1');

for (const decision of [
  'BLOCKED',
  'DISPATCHED',
  'SKIPPED',
  'APPROVED',
  'CONFIRMED',
  'REJECTED',
  'TRIGGERED',
  'NOT_TRIGGERED',
]) {
  assert.equal(contract.CANONICAL_DECISIONS.has(decision), true);
  assert.equal(contract.isCanonicalDecision(decision), true);
}

assert.equal(contract.CANONICAL_DECISIONS.size, 8);
assert.throws(() => contract.CANONICAL_DECISIONS.add('RESOLVED'), TypeError);
assert.throws(() => contract.CANONICAL_DECISIONS.clear(), TypeError);
assert.throws(() => Set.prototype.add.call(contract.CANONICAL_DECISIONS, 'RESOLVED'), TypeError);
assert.throws(() => Object.setPrototypeOf(contract.CANONICAL_DECISIONS, { has: () => true }), TypeError);
contract.CANONICAL_DECISIONS.forEach((_, __, exposedSet) => {
  assert.equal(exposedSet, contract.CANONICAL_DECISIONS);
  assert.throws(() => exposedSet.add('RESOLVED'), TypeError);
});
const originalSetHas = Set.prototype.has;
try {
  Set.prototype.has = () => true;
  assert.equal(contract.CANONICAL_DECISIONS.has('RESOLVED'), false);
  assert.equal(contract.isCanonicalDecision('RESOLVED'), false);
} finally {
  Set.prototype.has = originalSetHas;
}
try {
  Set.prototype.injectInvalidDecision = function injectInvalidDecision() {
    this.add('RESOLVED');
  };
  assert.equal(typeof contract.CANONICAL_DECISIONS.injectInvalidDecision, 'undefined');
} finally {
  delete Set.prototype.injectInvalidDecision;
}
assert.equal(contract.isCanonicalDecision('RESOLVED'), false);
assert.equal(contract.isCanonicalDecision(null), false);

for (const hardness of ['MANDATORY', 'HARD', 'CIRCUIT_BREAKER', 'SOFT', 'AUDIT']) {
  assert.equal(contract.CANONICAL_HARDNESS.has(hardness), true);
  assert.equal(contract.isCanonicalHardness(hardness), true);
}

assert.equal(contract.CANONICAL_HARDNESS.size, 5);
assert.throws(() => contract.CANONICAL_HARDNESS.delete('MANDATORY'), TypeError);
assert.throws(() => Object.setPrototypeOf(contract.CANONICAL_HARDNESS, { has: () => true }), TypeError);
assert.equal(contract.isCanonicalHardness('MANDATORY'), true);
assert.equal(contract.isCanonicalHardness('OPTIONAL'), false);
assert.deepEqual(contract.BASE_GATE_DECISION_KEYS, [
  'gate',
  'hardness',
  'phase',
  'decision',
  'decided_by',
  'timestamp',
  'detail',
  'confidence_impact',
]);
assert.deepEqual(contract.CORRELATION_KEYS, [
  'run_id',
  'plugin_version',
  'schema_version',
  'type',
  'complexity',
]);
assert.deepEqual(contract.ALLOWED_GATE_DECISION_KEYS, [
  ...contract.BASE_GATE_DECISION_KEYS,
  ...contract.CORRELATION_KEYS,
]);
assert.equal(Object.isFrozen(contract.BASE_GATE_DECISION_KEYS), true);
assert.equal(Object.isFrozen(contract.CORRELATION_KEYS), true);
assert.equal(Object.isFrozen(contract.ALLOWED_GATE_DECISION_KEYS), true);

console.log('gate decision contract OK');
