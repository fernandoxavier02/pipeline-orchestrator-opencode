'use strict';

// B2 (RED→GREEN) — arm/approve/reject the Plan-Mode gate, persisted via the OpenCode sentinel-state.
// approve/reject require a prior arm (forge guard). Read-only types arm with required=false.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { armPlanGate, approvePlanGate, rejectPlanGate, planRequiredFor } = require('../../src/opencode/plan-gate.cjs');
const { isPlanGateArmed } = require('../../src/validators/contract-validator.cjs');
const { loadSentinel } = require('../../src/opencode/gate-protocol-sentinel.cjs');

const adaptationRoot = path.resolve(__dirname, '..', '..');
const stateRoot = path.join(adaptationRoot, 'tmp', 'plan-gate-b2');
fs.rmSync(stateRoot, { recursive: true, force: true });
const now = '2026-06-17T00:00:00.000Z';

// planRequiredFor
assert.equal(planRequiredFor('Feature'), true);
assert.equal(planRequiredFor('Bug Fix'), true);
assert.equal(planRequiredFor('Spec'), true);
assert.equal(planRequiredFor('Audit'), false);
assert.equal(planRequiredFor('UX Simulation'), false);
assert.equal(planRequiredFor('Review'), false);
assert.equal(planRequiredFor(''), true);        // unknown → fail-safe
assert.equal(planRequiredFor(undefined), true);

// arm (Feature → required) and the persisted state is armed + schema-valid
let pg = armPlanGate({ stateRoot, runId: 'r1', type: 'Feature', now });
assert.equal(pg.required, true);
assert.equal(pg.approved, false);
assert.equal(isPlanGateArmed(loadSentinel(stateRoot, 'r1')), true, 'armed after arm');

// approve → disarmed, decision APPROVED
pg = approvePlanGate({ stateRoot, runId: 'r1', now });
assert.equal(pg.approved, true);
assert.equal(pg.decision, 'APPROVED');
assert.equal(isPlanGateArmed(loadSentinel(stateRoot, 'r1')), false, 'disarmed after approve');

// approve/reject WITHOUT a prior arm → throw (forge guard)
assert.throws(() => approvePlanGate({ stateRoot, runId: 'r2-never-armed', now }), /arm/i);
assert.throws(() => rejectPlanGate({ stateRoot, runId: 'r3-never-armed', now }), /arm/i);

// reject after arm
armPlanGate({ stateRoot, runId: 'r4', type: 'Feature', now });
pg = rejectPlanGate({ stateRoot, runId: 'r4', now });
assert.equal(pg.approved, false);
assert.equal(pg.decision, 'REJECTED');

// Audit run → required:false → never armed
pg = armPlanGate({ stateRoot, runId: 'r5', type: 'Audit', now });
assert.equal(pg.required, false);
assert.equal(isPlanGateArmed(loadSentinel(stateRoot, 'r5')), false, 'audit run not armed');

// sticky decisions (adversarial round): a decided gate must be re-armed before a new decision
armPlanGate({ stateRoot, runId: 'r6', type: 'Feature', now });
approvePlanGate({ stateRoot, runId: 'r6', now });
assert.throws(() => approvePlanGate({ stateRoot, runId: 'r6', now }), /already decided|re-arm/i, 'approve-after-approve must throw');
assert.throws(() => rejectPlanGate({ stateRoot, runId: 'r6', now }), /already decided|re-arm/i, 'reject-after-approve must throw (rejection cannot revoke an approval without re-arm)');
// re-arm resets the decision → can decide again
armPlanGate({ stateRoot, runId: 'r6', type: 'Feature', now });
assert.equal(approvePlanGate({ stateRoot, runId: 'r6', now }).approved, true);
// approve-after-reject must throw
armPlanGate({ stateRoot, runId: 'r7', type: 'Feature', now });
rejectPlanGate({ stateRoot, runId: 'r7', now });
assert.throws(() => approvePlanGate({ stateRoot, runId: 'r7', now }), /already decided|re-arm/i, 'approve-after-reject must throw');

fs.rmSync(stateRoot, { recursive: true, force: true });
console.log('plan-gate-record OK');
