'use strict';

const DEFAULT_MAX = 3;

function decideFixLoop(ctx) {
  if (!ctx || typeof ctx !== 'object') return { decision: 'allow' };
  const attempts = Number.isFinite(ctx.attempts) ? ctx.attempts : 0;
  const max = Number.isFinite(ctx.max) && ctx.max > 0 ? ctx.max : DEFAULT_MAX;
  if (attempts < max) return { decision: 'allow', attempts, max };
  if (String(ctx.enforce || 'deny').toLowerCase() === 'warn') return { decision: 'allow', warn: true, attempts, max };
  return {
    decision: 'block',
    attempts,
    max,
    reason: `FIX_LOOP_EXHAUSTED: ${attempts} tentativa(s) de conserto ja feitas (teto ${max}). Nao dispare outro executor-fix.`,
  };
}

module.exports = { decideFixLoop, DEFAULT_MAX };
