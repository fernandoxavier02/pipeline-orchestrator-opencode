'use strict';

const { readOnlySet } = require('./read-only-set.cjs');

const GOVERNED = readOnlySet(['checkpoint-validator', 'final-validator']);

function buildReason(leaf, checkpoints, reviews) {
  const lagging = checkpoints - reviews;
  return (
    `BATCH_REVIEW_MISSING: ${checkpoints} batch(es) passaram pelo checkpoint mas ` +
    `so ${reviews} tiveram revisao adversarial - ${lagging} batch(es) sem revisao. ` +
    `NAO dispare ${leaf}: rode a revisao adversarial (review-orchestrator) do batch ` +
    'pendente ANTES de avancar/fechar.'
  );
}

function decideBatchReview(ctx) {
  if (!ctx || typeof ctx !== 'object') return { decision: 'allow' };
  const leaf = ctx.agentLeaf;
  if (typeof leaf !== 'string' || !GOVERNED.has(leaf)) return { decision: 'allow' };
  const checkpoints = Number.isFinite(ctx.checkpointsDone) ? ctx.checkpointsDone : 0;
  const reviews = Number.isFinite(ctx.reviewsDone) ? ctx.reviewsDone : 0;
  if (reviews >= checkpoints) return { decision: 'allow', checkpoints, reviews };
  const sensitive = ctx.sensitive === true;
  if (!sensitive && String(ctx.enforce || 'deny').toLowerCase() === 'warn') {
    return { decision: 'allow', warn: true, checkpoints, reviews };
  }
  let reason = buildReason(leaf, checkpoints, reviews);
  if (sensitive) {
    reason += ` Este batch tocou dominio SENSIVEL (${(Array.isArray(ctx.domains) ? ctx.domains.join(', ') : 'auth/cripto/pagamento/dados')}) - a revisao e OBRIGATORIA e NAO pode ser pulada.`;
  }
  return { decision: 'block', checkpoints, reviews, sensitive, reason };
}

module.exports = { decideBatchReview, buildReason, GOVERNED };
