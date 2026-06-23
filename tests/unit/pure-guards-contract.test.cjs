'use strict';

const assert = require('node:assert/strict');

const batch = require('../../src/lib/batch-review-guard.cjs');
const checkpoint = require('../../src/lib/checkpoint-verdict.cjs');
const failures = require('../../src/lib/consecutive-failure-counter.cjs');
const domains = require('../../src/lib/domain-scanner.cjs');
const fixLoop = require('../../src/lib/fix-loop.cjs');
const gateLog = require('../../src/lib/gate-log-guard.cjs');
const phase = require('../../src/lib/phase-verdict-guard.cjs');
const ledger = require('../../src/lib/step-ledger.cjs');
const classifier = require('../../src/lib/pipeline-workflow-classifier.cjs');

assert.equal(batch.GOVERNED.has('checkpoint-validator'), true);
assert.throws(() => batch.GOVERNED.add('evil-agent'), TypeError);
assert.equal(batch.decideBatchReview({ agentLeaf: 'executor-controller', checkpointsDone: 3, reviewsDone: 0 }).decision, 'allow');
assert.equal(batch.decideBatchReview({ agentLeaf: 'final-validator', checkpointsDone: 2, reviewsDone: 1 }).decision, 'block');
assert.equal(batch.decideBatchReview({ agentLeaf: 'final-validator', checkpointsDone: 2, reviewsDone: 1, enforce: 'warn' }).warn, true);
assert.equal(batch.decideBatchReview({ agentLeaf: 'final-validator', checkpointsDone: 2, reviewsDone: 1, enforce: 'warn', sensitive: true }).decision, 'block');

assert.equal(checkpoint.normalizeVerdict(true), 'pass');
assert.equal(checkpoint.normalizeVerdict({ verdict: 'red' }), 'fail');
assert.equal(checkpoint.normalizeVerdict('green'), 'pass');
assert.equal(checkpoint.normalizeVerdict('unknown'), null);
assert.equal(checkpoint.decideCheckpointVerdict({ agentLeaf: 'review-orchestrator', lastVerdict: 'fail' }).decision, 'block');
assert.equal(checkpoint.decideCheckpointVerdict({ agentLeaf: 'review-orchestrator', lastVerdict: 'fail', enforce: 'warn' }).warn, true);
assert.equal(checkpoint.decideCheckpointVerdict({ agentLeaf: 'executor-fix', lastVerdict: 'fail' }).decision, 'allow');

assert.equal(failures.DEFAULT_MAX, 2);
assert.equal(failures.decideConsecutiveFailures({ agentLeaf: 'final-validator', failures: 1 }).decision, 'allow');
assert.equal(failures.decideConsecutiveFailures({ agentLeaf: 'final-validator', failures: 2 }).decision, 'block');
assert.equal(failures.decideConsecutiveFailures({ agentLeaf: 'final-validator', failures: 2, enforce: 'warn' }).warn, true);

assert.deepEqual(domains.scanDomains(['src/auth/login.ts', 'db/schema.sql', 'docs/authors.md', 'src/tokenizer.ts']), ['auth', 'data-model']);
assert.deepEqual(domains.scanDomains(['payments/stripe_checkout.js', 'lib/crypto/signer.cjs']), ['crypto', 'payment']);
assert.deepEqual(domains.scanDomains(['src/authService.ts', 'ui/LoginForm.tsx', 'auth/passwordReset.ts']), ['auth']);
assert.deepEqual(domains.scanDomains(['billing/stripeCheckout.ts', 'src/UserRepository.ts', 'keys/privateKey.ts']), ['crypto', 'data-model', 'payment']);
assert.deepEqual(domains.scanDomains('not-array'), []);
assert.equal(Object.isFrozen(domains.PATTERNS), true);
assert.throws(() => { domains.PATTERNS.auth.test = () => false; }, TypeError);
assert.deepEqual(domains.scanDomains(['src/auth/login.ts']), ['auth']);

assert.equal(fixLoop.DEFAULT_MAX, 3);
assert.equal(fixLoop.decideFixLoop({ attempts: 2 }).decision, 'allow');
assert.equal(fixLoop.decideFixLoop({ attempts: 3 }).decision, 'block');
assert.equal(fixLoop.decideFixLoop({ attempts: 3, enforce: 'warn' }).warn, true);

assert.deepEqual(gateLog.REQUIRED_GATES_BEFORE['executor-controller'], ['TDD_APPROVAL']);
assert.equal(gateLog.decideGateLog({ agentLeaf: 'executor-controller', loggedGates: [] }).decision, 'block');
assert.equal(gateLog.decideGateLog({ agentLeaf: 'executor-controller', loggedGates: ['TDD_APPROVAL'] }).decision, 'allow');
assert.equal(gateLog.decideGateLog({ agentLeaf: 'executor-controller', loggedGates: [], enforce: 'warn' }).warn, true);
const parsedGates = gateLog.parseLoggedGates([
  '{"gate":"TDD_APPROVAL ","run_id":"run-a"}',
  '{"gate":"ADVERSARIAL_GATE","run_id":"run-b"}',
  'not json',
].join('\n'), 'run-a');
assert.deepEqual([...parsedGates], ['TDD_APPROVAL']);
const parsedCamelRunIdGates = gateLog.parseLoggedGates([
  '{"gate":"TDD_APPROVAL","runId":"run-b"}',
  '{"gate":"ADVERSARIAL_GATE","runId":"run-a"}',
].join('\n'), 'run-a');
assert.deepEqual([...parsedCamelRunIdGates], ['ADVERSARIAL_GATE']);

assert.equal(phase.decidePhaseVerdict({ agentLeaf: 'executor-controller', state: { plan_status: 'rejected' } }).code, 'PLAN_REJECTED');
assert.equal(phase.decidePhaseVerdict({ agentLeaf: 'finishing-branch', state: { final_decision: 'NO-GO' } }).code, 'GO_NOGO_BLOCK');
assert.equal(phase.decidePhaseVerdict({ agentLeaf: 'executor-controller', state: { info_gate: 'blocked' }, enforce: 'warn' }).warn, true);
assert.equal(phase.governedLeaves().has('final-validator'), true);
assert.equal(Object.isFrozen(phase.RULES), true);

assert.deepEqual(ledger.requiredStepsFor('FULL').slice(0, 4), ['classify', 'info-gate', 'proposal', 'plan']);
assert.deepEqual(ledger.requiredStepsFor('missing'), []);
assert.equal(ledger.stepForAgent('FULL', 'executor-controller'), 'execute');
assert.deepEqual(ledger.agentStepsFor('FULL'), ['classify', 'info-gate', 'plan', 'tdd', 'execute', 'adversarial', 'sanity', 'final']);
assert.equal(ledger.decideAgentSpawn({ workflowKey: 'FULL', agentType: 'pipeline:final-validator', stampedSteps: ['classify'] }).decision, 'block');
assert.equal(ledger.decideAgentSpawn({ workflowKey: 'FULL', agentType: 'pipeline:information-gate', stampedSteps: ['classify'] }).decision, 'allow');
assert.equal(ledger.decideStep({ requiredSteps: ['a', 'b'], stampedSteps: [], attemptedStep: 'b', enforce: 'warn' }).warn, true);

assert.equal(classifier.isPipelineInvocation('/pipeline build this'), true);
assert.equal(classifier.isPipelineInvocation('plain prompt'), false);
assert.deepEqual([...classifier.MODES], ['FULL', 'DIAGNOSTIC', 'CONTINUE', 'HOTFIX', 'REVIEW-ONLY', 'PAPERCLIP']);
assert.deepEqual([...classifier.TYPES], ['Bug Fix', 'Feature', 'User Story', 'Audit', 'UX Simulation', 'Spec']);
assert.throws(() => classifier.MODES.add('MIRROR'), TypeError);
assert.deepEqual(classifier.classifyWorkflow('/pipeline --hotfix repair'), {
  mode: 'HOTFIX', type: 'Bug Fix', variant: 'bugfix-heavy', complexity: 'COMPLEXA', source: 'flag:--hotfix',
});
assert.equal(classifier.classifyWorkflow('/pipeline --type=spec --bugfix specs').type, 'Spec');
assert.equal(classifier.classifyWorkflow('/pipeline corrigir erro').type, 'Bug Fix');

console.log('pure guards contract OK');
