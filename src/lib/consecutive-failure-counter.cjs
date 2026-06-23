'use strict';

const { readOnlySet } = require('./read-only-set.cjs');

const DEFAULT_MAX = 2;
const BLOCKED_WHEN_TRIPPED = readOnlySet(['review-orchestrator', 'final-validator']);

function buildReason(leaf, failures, max) {
  return `STOP_RULE: ${failures} falha(s) consecutiva(s) de checkpoint/sanidade (teto ${max}). Nao avance disparando ${leaf}.`;
}

function decideConsecutiveFailures(ctx) {
  if (!ctx || typeof ctx !== 'object') return { decision: 'allow' };
  const leaf = ctx.agentLeaf;
  if (typeof leaf !== 'string' || !BLOCKED_WHEN_TRIPPED.has(leaf)) return { decision: 'allow' };
  const currentFailures = Number.isFinite(ctx.failures) ? ctx.failures : 0;
  const max = Number.isFinite(ctx.max) && ctx.max > 0 ? ctx.max : DEFAULT_MAX;
  if (currentFailures < max) return { decision: 'allow', failures: currentFailures, max };
  if (String(ctx.enforce || 'deny').toLowerCase() === 'warn') return { decision: 'allow', warn: true, failures: currentFailures, max };
  return { decision: 'block', failures: currentFailures, max, reason: buildReason(leaf, currentFailures, max) };
}

module.exports = { decideConsecutiveFailures, buildReason, DEFAULT_MAX, BLOCKED_WHEN_TRIPPED };
