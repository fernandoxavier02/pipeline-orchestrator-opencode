'use strict';

const assert = require('node:assert/strict');

const manifest = require('../../src/lib/contracts/workflow-manifest.cjs');

assert.deepEqual(Object.keys(manifest.WORKFLOWS), [
  'FULL',
  'DIAGNOSTIC',
  'REVIEW-ONLY',
  'HOTFIX',
  'PAPERCLIP',
  'Spec',
  'brainstorm',
]);

assert.deepEqual(manifest.WORKFLOWS.FULL.steps, [
  'classify',
  'info-gate',
  'proposal',
  'plan',
  'tdd',
  'execute',
  'adversarial',
  'sanity',
  'final',
]);
assert.deepEqual(manifest.WORKFLOWS.FULL.agents_by_step.classify, ['task-orchestrator']);
assert.deepEqual(manifest.WORKFLOWS.FULL.agents_by_step.plan, ['plan-architect']);
assert.deepEqual(manifest.WORKFLOWS.FULL.agents_by_step.final, ['final-validator']);
assert.equal(manifest.WORKFLOWS.FULL.agents_by_step.proposal, undefined);

assert.deepEqual(manifest.nextAllowedAgents('FULL', 'classify'), ['information-gate']);
assert.deepEqual(manifest.nextAllowedAgents('FULL', 'info-gate'), ['plan-architect']);
assert.deepEqual(manifest.nextAllowedAgents('FULL', 'final'), []);
assert.deepEqual(manifest.nextAllowedAgents('DIAGNOSTIC', 'classify'), []);

assert.equal(manifest.isTransitionAllowed('FULL', 'classify', 'info-gate'), true);
assert.equal(manifest.isTransitionAllowed('FULL', 'execute', 'tdd'), false);
assert.equal(manifest.isTransitionAllowed('UNKNOWN', 'execute', 'tdd'), true);
assert.equal(manifest.isTransitionAllowed('DIAGNOSTIC', 'execute', 'tdd'), true);
assert.equal(manifest.isTransitionAllowed('FULL', 'outside', 'tdd'), true);

assert.equal(manifest.resultRequired('FULL', 'tdd'), true);
assert.equal(manifest.resultRequired('FULL', 'proposal'), false);
assert.equal(manifest.evidenceRequired('FULL', 'execute'), true);
assert.equal(manifest.evidenceRequired('FULL', 'final'), false);
assert.deepEqual(manifest.buildEvidenceRequired('FULL'), {
  classify: false,
  'info-gate': false,
  proposal: false,
  plan: false,
  tdd: true,
  execute: true,
  adversarial: true,
  sanity: true,
  final: false,
});
assert.deepEqual(manifest.buildEvidenceRequired('HOTFIX'), {});

assert.deepEqual(manifest.TERMINAL_STATES, ['completed', 'hard_failed', 'aborted_by_user', 'cancelled']);
assert.equal(manifest.isTerminal('completed'), true);
assert.equal(manifest.isTerminal('failed'), false);
const originalSetHas = Set.prototype.has;
try {
  Set.prototype.has = () => true;
  assert.equal(manifest.isTerminal('failed'), false);
} finally {
  Set.prototype.has = originalSetHas;
}

assert.deepEqual(manifest.DENY_EXCEPTIONS, {
  state_corrupt_governed: 'deny',
  ungoverned: 'allow',
  state_absent: 'allow',
  state_unsigned: 'allow',
  state_corrupt_ungoverned: 'allow',
});
assert.equal(manifest.denyException('state_corrupt_governed'), 'deny');
assert.equal(manifest.denyException('unknown'), 'allow');

assert.equal(Object.isFrozen(manifest.WORKFLOWS), true);
assert.equal(Object.isFrozen(manifest.WORKFLOWS.FULL), true);
assert.equal(Object.isFrozen(manifest.WORKFLOWS.FULL.steps), true);
assert.equal(Object.isFrozen(manifest.WORKFLOWS.FULL.agents_by_step.plan), true);
assert.equal(Object.isFrozen(manifest.TERMINAL_STATES), true);
assert.equal(Object.isFrozen(manifest.DENY_EXCEPTIONS), true);

console.log('workflow manifest contract OK');
