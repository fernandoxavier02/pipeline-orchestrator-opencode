'use strict';

// B2 — Plan-Mode gate arm/approve/reject for the OpenCode runtime.
//
// Mirrors the Claude Code `scripts/record-plan-gate.cjs`, but persists into the OpenCode
// `sentinel-state.json` through the existing `loadSentinel`/`saveSentinel` (schema-validated by
// contract-validator; OpenCode has no HMAC). approve/reject REQUIRE a prior arm — this blocks the
// "approve on a blank/unarmed state silently disarms the gate" forge (mirrors the Claude Code CORR-3 fix).
//
// Coverage: the gate is REQUIRED for code-writing types (Bug Fix, Feature, User Story, Spec) across all
// complexities; read-only types (Audit, UX Simulation, Review) → required=false (gate never blocks them).

const { loadSentinel, saveSentinel } = require('./gate-protocol-sentinel.cjs');

const READ_ONLY_TYPES = new Set(['Audit', 'UX Simulation', 'UX', 'Review']);

function planRequiredFor(type) {
  if (typeof type !== 'string' || !type.trim()) return true; // unknown → require (fail-safe)
  return !READ_ONLY_TYPES.has(type.trim());
}

function armPlanGate({ stateRoot, runId, type, now }) {
  const ts = now || new Date().toISOString();
  const state = loadSentinel(stateRoot, runId, ts);
  state.planGate = { required: planRequiredFor(type), approved: false, decision: null, approvedAt: null, executed: false };
  state.updatedAt = ts;
  saveSentinel(stateRoot, runId, state);
  return state.planGate;
}

function approvePlanGate({ stateRoot, runId, now }) {
  const ts = now || new Date().toISOString();
  const state = loadSentinel(stateRoot, runId, ts);
  const prev = state.planGate;
  if (!prev || typeof prev.required !== 'boolean' || typeof prev.approved !== 'boolean') {
    throw new Error('cannot approve: plan gate was never armed (run "arm" first)');
  }
  if (prev.decision !== null && prev.decision !== undefined) {
    // A decided gate (APPROVED/REJECTED) is sticky — must be re-armed before a new decision.
    throw new Error(`cannot approve: plan gate already decided (${prev.decision}) — re-arm first`);
  }
  state.planGate = { required: prev.required, approved: true, decision: 'APPROVED', approvedAt: ts, executed: true };
  state.updatedAt = ts;
  saveSentinel(stateRoot, runId, state);
  return state.planGate;
}

function rejectPlanGate({ stateRoot, runId, now }) {
  const ts = now || new Date().toISOString();
  const state = loadSentinel(stateRoot, runId, ts);
  const prev = state.planGate;
  if (!prev || typeof prev.required !== 'boolean' || typeof prev.approved !== 'boolean') {
    throw new Error('cannot reject: plan gate was never armed (run "arm" first)');
  }
  if (prev.decision !== null && prev.decision !== undefined) {
    throw new Error(`cannot reject: plan gate already decided (${prev.decision}) — re-arm first`);
  }
  state.planGate = { required: prev.required, approved: false, decision: 'REJECTED', approvedAt: null, executed: true };
  state.updatedAt = ts;
  saveSentinel(stateRoot, runId, state);
  return state.planGate;
}

module.exports = { armPlanGate, approvePlanGate, rejectPlanGate, planRequiredFor };
