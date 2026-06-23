'use strict';

const RULES = Object.freeze([
  Object.freeze({
    code: 'SSOT_CONFLICT', field: 'ssot_status', blockValues: Object.freeze(['conflict']),
    leaves: Object.freeze(['information-gate', 'plan-architect', 'executor-controller', 'review-orchestrator', 'sanity-checker', 'final-validator', 'finishing-branch']),
    reason: () => 'SSOT_CONFLICT: ha um conflito de fonte de verdade registrado - resolva antes de prosseguir.',
  }),
  Object.freeze({
    code: 'INFO_GATE_BLOCKED', field: 'info_gate', blockValues: Object.freeze(['blocked']),
    leaves: Object.freeze(['plan-architect', 'executor-controller']),
    reason: () => 'INFO_GATE_BLOCKED: o portao de informacao esta bloqueado.',
  }),
  Object.freeze({
    code: 'PLAN_REJECTED', field: 'plan_status', blockValues: Object.freeze(['rejected']),
    leaves: Object.freeze(['executor-controller']),
    reason: () => 'PLAN_REJECTED: o plano foi rejeitado - volte ao planejamento antes de executar.',
  }),
  Object.freeze({
    code: 'FINAL_ADVERSARIAL_REWORK', field: 'final_review_verdict', blockValues: Object.freeze(['critical_open']),
    leaves: Object.freeze(['finishing-branch']),
    reason: () => 'FINAL_ADVERSARIAL_REWORK: ha achado critico em aberto antes do fechamento.',
  }),
  Object.freeze({
    code: 'GO_NOGO_BLOCK', field: 'final_decision', blockValues: Object.freeze(['NO-GO', 'NO_GO', 'NOGO']),
    leaves: Object.freeze(['finishing-branch']),
    reason: (_field, value) => `GO_NOGO_BLOCK: o validador final decidiu ${value} - nao feche sem resolver pendencias.`,
  }),
]);

function decidePhaseVerdict(ctx) {
  if (!ctx || typeof ctx !== 'object') return { decision: 'allow' };
  const leaf = ctx.agentLeaf;
  if (typeof leaf !== 'string' || !leaf) return { decision: 'allow' };
  const state = (ctx.state && typeof ctx.state === 'object') ? ctx.state : {};
  const warn = String(ctx.enforce || 'deny').toLowerCase() === 'warn';
  for (const rule of RULES) {
    if (!rule.leaves.includes(leaf)) continue;
    const value = state[rule.field];
    if (typeof value === 'string' && rule.blockValues.includes(value)) {
      if (warn) return { decision: 'allow', warn: true, code: rule.code };
      return { decision: 'block', code: rule.code, reason: rule.reason(rule.field, value) };
    }
  }
  return { decision: 'allow' };
}

function governedLeaves() {
  const out = new Set();
  for (const rule of RULES) for (const leaf of rule.leaves) out.add(leaf);
  return out;
}

module.exports = { decidePhaseVerdict, governedLeaves, RULES };
