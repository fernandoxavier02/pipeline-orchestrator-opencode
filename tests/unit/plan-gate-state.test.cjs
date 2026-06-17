'use strict';

// B1 (RED→GREEN) — planGate field on the sentinel-state + fail-closed validation.
// Ports the Claude Code Plan-Mode gate state (phase_1_5_plan) to the OpenCode runtime.
// Integrity is by SCHEMA validation here (OpenCode has no HMAC), so a malformed planGate
// must FAIL validation (corrupt-blocks). An ABSENT planGate stays valid (backward compat).

const assert = require('node:assert/strict');
const {
  validateSentinelState,
  isPlanGateArmed,
} = require('../../src/validators/contract-validator.cjs');

function baseState(extra) {
  return Object.assign({
    schemaVersion: 'SENTINEL_STATE/v1',
    runId: 'r1',
    currentPhase: 'planned',
    checkpoints: {},
    blocked: false,
    stopRuleTriggered: false,
    lastValidEventId: null,
    updatedAt: '2026-06-17T00:00:00.000Z',
  }, extra || {});
}

// planGate ABSENT → valid (backward compat with legacy states)
assert.equal(validateSentinelState(baseState()).ok, true, 'absent planGate must stay valid');

// planGate VALID → valid
assert.equal(
  validateSentinelState(baseState({ planGate: { required: true, approved: false, decision: null, approvedAt: null, executed: false } })).ok,
  true,
  'well-formed planGate must validate',
);
assert.equal(
  validateSentinelState(baseState({ planGate: { required: false, approved: true, decision: 'APPROVED', approvedAt: '2026-06-17T01:00:00.000Z', executed: true } })).ok,
  true,
);

// planGate MALFORMED → fail with PLAN_GATE_INVALID (corrupt-blocks)
let r = validateSentinelState(baseState({ planGate: { required: 'yes', approved: false } }));
assert.equal(r.ok, false); assert.equal(r.code, 'PLAN_GATE_INVALID', 'non-boolean required must fail');

r = validateSentinelState(baseState({ planGate: { required: true } }));
assert.equal(r.ok, false); assert.equal(r.code, 'PLAN_GATE_INVALID', 'missing approved must fail');

r = validateSentinelState(baseState({ planGate: 42 }));
assert.equal(r.ok, false); assert.equal(r.code, 'PLAN_GATE_INVALID', 'non-object planGate must fail');

r = validateSentinelState(baseState({ planGate: { required: true, approved: false, decision: 7 } }));
assert.equal(r.ok, false); assert.equal(r.code, 'PLAN_GATE_INVALID', 'non-string/non-null decision must fail');

// isPlanGateArmed(state): required===true && approved!==true
assert.equal(isPlanGateArmed(baseState({ planGate: { required: true, approved: false } })), true);
assert.equal(isPlanGateArmed(baseState({ planGate: { required: true, approved: true } })), false);
assert.equal(isPlanGateArmed(baseState({ planGate: { required: false, approved: false } })), false);
assert.equal(isPlanGateArmed(baseState()), false, 'no planGate → not armed (legacy)');
assert.equal(isPlanGateArmed(null), false);
assert.equal(isPlanGateArmed({}), false);

// decision enum (adversarial round): only null / APPROVED / REJECTED are valid
let re = validateSentinelState(baseState({ planGate: { required: true, approved: true, decision: 'banana' } }));
assert.equal(re.ok, false); assert.equal(re.code, 'PLAN_GATE_INVALID', 'arbitrary decision string must fail');
assert.equal(validateSentinelState(baseState({ planGate: { required: false, approved: false, decision: 'REJECTED' } })).ok, true);
assert.equal(validateSentinelState(baseState({ planGate: { required: true, approved: true, decision: 'APPROVED' } })).ok, true);

console.log('plan-gate-state OK');
