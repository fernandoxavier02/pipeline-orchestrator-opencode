'use strict';

const { readOnlySet } = require('./read-only-set.cjs');

const BLOCKED_WHEN_RED = readOnlySet(['review-orchestrator', 'final-validator']);

function buildReason(leaf) {
  return `CHECKPOINT_RED: o ultimo checkpoint falhou - nao avance disparando ${leaf} enquanto estiver vermelho.`;
}

function decideCheckpointVerdict(ctx) {
  if (!ctx || typeof ctx !== 'object') return { decision: 'allow' };
  const leaf = ctx.agentLeaf;
  if (typeof leaf !== 'string' || !BLOCKED_WHEN_RED.has(leaf)) return { decision: 'allow' };
  if (ctx.lastVerdict !== 'fail') return { decision: 'allow', lastVerdict: ctx.lastVerdict || null };
  if (String(ctx.enforce || 'deny').toLowerCase() === 'warn') return { decision: 'allow', warn: true, lastVerdict: 'fail' };
  return { decision: 'block', lastVerdict: 'fail', reason: buildReason(leaf) };
}

function normalizeVerdict(raw) {
  if (raw === true) return 'pass';
  if (raw === false) return 'fail';
  const value = (raw && typeof raw === 'object') ? raw.verdict : raw;
  if (typeof value !== 'string') return null;
  const low = value.trim().toLowerCase();
  if (low === 'pass' || low === 'passed' || low === 'green' || low === 'ok') return 'pass';
  if (low === 'fail' || low === 'failed' || low === 'red') return 'fail';
  return null;
}

module.exports = { decideCheckpointVerdict, normalizeVerdict, buildReason, BLOCKED_WHEN_RED };
