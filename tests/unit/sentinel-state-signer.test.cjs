'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const signer = require('../../src/lib/sentinel-state-signer.cjs');
const { isPlanGateArmed } = require('../../src/validators/contract-validator.cjs');

function validSentinel(extra = {}) {
  return {
    schemaVersion: 'SENTINEL_STATE/v1',
    runId: 'run-w0-7',
    currentPhase: 'phase_0_to_1',
    checkpoints: {},
    blocked: false,
    stopRuleTriggered: false,
    lastValidEventId: null,
    updatedAt: '2026-06-22T00:00:00.000Z',
    ...extra,
  };
}

assert.equal(typeof signer.verifyState, 'function');
assert.equal(typeof signer.readVerifiedState, 'function');
assert.equal(typeof signer.signState, 'function');
assert.equal(typeof signer.writeSignedState, 'function');
assert.equal(signer.SIGNATURE_FIELD, '__signature');

process.env.PIPELINE_HMAC_STRICT = 'true';
let verification = signer.verifyState(validSentinel());
delete process.env.PIPELINE_HMAC_STRICT;
assert.equal(verification.valid, true);
assert.equal(verification.unsigned, true);
assert.equal(verification.key_unavailable, false);
assert.match(verification.reason, /schema valid/i);

verification = signer.verifyState({ ...validSentinel(), schemaVersion: 'WRONG/v1' });
assert.equal(verification.valid, false);
assert.equal(verification.unsigned, false);
assert.equal(verification.key_unavailable, false);
assert.match(verification.reason, /SCHEMA_VERSION_INVALID/);

const inheritedCheckpoint = Object.create({
  status: 'PASS',
  eventId: 'evt-inherited',
  checkedAt: '2026-06-22T00:00:00.000Z',
});
verification = signer.verifyState(validSentinel({ checkpoints: { phase_0_to_1: inheritedCheckpoint } }));
assert.equal(verification.valid, false);

const inheritedPlanGate = Object.create({ required: true, approved: true });
verification = signer.verifyState(validSentinel({ planGate: inheritedPlanGate }));
assert.equal(verification.valid, false);

const inheritedRequiredCheckpoint = {
  status: 'PASS',
  eventId: 'evt-inherited-required',
  checkedAt: '2026-06-22T00:00:00.000Z',
};
const inheritedCheckpointsMap = Object.create({
  phase_0_to_1: inheritedRequiredCheckpoint,
  phase_1_to_2: inheritedRequiredCheckpoint,
});
verification = signer.verifyState(validSentinel({ checkpoints: inheritedCheckpointsMap }), { phase: 'before_execution' });
assert.equal(verification.valid, false);

const planGateWithInheritedApproval = { required: true };
Object.setPrototypeOf(planGateWithInheritedApproval, { approved: true });
assert.equal(isPlanGateArmed({ planGate: planGateWithInheritedApproval }), true);

const stateWithInheritedPlanGate = Object.create({ planGate: { required: true, approved: false } });
assert.equal(isPlanGateArmed(stateWithInheritedPlanGate), false);

const signedLooking = validSentinel({ __signature: { algorithm: 'sha256', value: 'bad' } });
verification = signer.verifyState(signedLooking, { key: 'ignored-by-opencode-adapter' });
assert.equal(verification.valid, true);
assert.equal(verification.unsigned, true);
assert.equal(verification.key_unavailable, false);

const unsigned = signer.signState(signedLooking);
assert.equal(Object.prototype.hasOwnProperty.call(unsigned, '__signature'), false);
assert.equal(unsigned.runId, 'run-w0-7');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w0-7-signer-'));
const statePath = path.join(tmp, 'sentinel-state.json');
fs.writeFileSync(statePath, JSON.stringify(validSentinel(), null, 2));
const read = signer.readVerifiedState(statePath);
assert.equal(read.state.runId, 'run-w0-7');
assert.equal(read.verification.valid, true);
assert.equal(read.verification.unsigned, true);
assert.equal(read.verification.key_unavailable, false);

const writtenPath = path.join(tmp, 'written-sentinel-state.json');
const written = signer.writeSignedState(writtenPath, signedLooking);
assert.equal(Object.prototype.hasOwnProperty.call(written, '__signature'), false);
assert.equal(JSON.parse(fs.readFileSync(writtenPath, 'utf8')).runId, 'run-w0-7');

console.log('sentinel state signer OK');
