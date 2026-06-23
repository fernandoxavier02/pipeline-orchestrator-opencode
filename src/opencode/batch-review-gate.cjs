'use strict';

const {
  CORRUPT_SENTINEL,
  findActiveSentinelState,
} = require('../state/sentinel-state-inspector.cjs');
const guard = require('../lib/batch-review-guard.cjs');
const {
  canonicalAgentLeaf,
  projectDirFromInput,
  rawAgentNameFromInput,
} = require('./step-ledger-gate.cjs');

const BEFORE_HOOK_MARKER = Symbol.for('pipeline-orchestrator.batch-review.tool.execute.before.processed');

function normalizeToolName(toolName) {
  return String(toolName || '').trim().toLowerCase();
}

function loadActiveState(projectDir, options = {}) {
  const reader = options.findActiveSentinelState || findActiveSentinelState;
  try { return reader(projectDir); } catch { return null; }
}

function buildCorruptReason(agentLeaf) {
  return `BATCH_REVIEW_STATE_CORRUPT: sentinel-state is unreadable, so batch review counters are not trustworthy and ${agentLeaf} is blocked.`;
}

function decideBatchReviewGate(ctx) {
  if (!ctx || typeof ctx !== 'object') return { decision: 'allow' };
  if (normalizeToolName(ctx.toolName) !== 'task') return { decision: 'allow' };
  if (!ctx.projectDir) return { decision: 'allow' };

  const agentLeaf = canonicalAgentLeaf(ctx.agentName);
  if (!agentLeaf || !guard.GOVERNED.has(agentLeaf)) return { decision: 'allow' };

  const state = ctx.state;
  if (!state) return { decision: 'allow' };
  if (state === CORRUPT_SENTINEL) {
    return { decision: 'block', code: 'BATCH_REVIEW_STATE_CORRUPT', reason: buildCorruptReason(agentLeaf) };
  }
  if (state.pipeline_active !== true) return { decision: 'allow' };

  const domains = Array.isArray(state.domains_touched) ? state.domains_touched : [];
  const decision = guard.decideBatchReview({
    agentLeaf,
    checkpointsDone: Number.isFinite(state.batch_checkpoints_done) ? state.batch_checkpoints_done : 0,
    reviewsDone: Number.isFinite(state.batch_reviews_done) ? state.batch_reviews_done : 0,
    sensitive: domains.length > 0,
    domains,
    enforce: process.env.PIPELINE_BATCH_REVIEW_ENFORCEMENT || 'deny',
  });
  if (decision.decision === 'block') return { code: 'BATCH_REVIEW_MISSING', ...decision };
  return decision;
}

function markOnce(target) {
  if (!target || typeof target !== 'object') return true;
  if (target[BEFORE_HOOK_MARKER]) return false;
  Object.defineProperty(target, BEFORE_HOOK_MARKER, { value: true, enumerable: false, configurable: false });
  return true;
}

function gatherContext(input, options = {}) {
  const projectDir = projectDirFromInput(input, options);
  return {
    toolName: input && (input.tool || input.toolName || input.tool_name),
    agentName: rawAgentNameFromInput(input),
    projectDir,
    state: projectDir ? loadActiveState(projectDir, options) : null,
  };
}

function handleToolExecuteBefore(input, output = {}, options = {}) {
  if (!markOnce(output)) return output;
  if (output.error) return output;
  const result = decideBatchReviewGate(gatherContext(input, options));
  if (result.decision === 'block') {
    output.error = {
      code: result.code || 'BATCH_REVIEW_BLOCKED',
      reason: result.reason,
      checkpoints: result.checkpoints,
      reviews: result.reviews,
      sensitive: result.sensitive,
    };
  } else if (result.warn) {
    output.warning = {
      code: result.code || 'BATCH_REVIEW_MISSING',
      checkpoints: result.checkpoints,
      reviews: result.reviews,
    };
  }
  if (typeof options.audit === 'function') options.audit({ type: `batch-review.${result.decision}`, result });
  return output;
}

function createBatchReviewGateHooks(options = {}) {
  return {
    'tool.execute.before': (input, output = {}) => handleToolExecuteBefore(input, output, options),
  };
}

module.exports = {
  BEFORE_HOOK_MARKER,
  normalizeToolName,
  loadActiveState,
  buildCorruptReason,
  gatherContext,
  decideBatchReviewGate,
  handleToolExecuteBefore,
  createBatchReviewGateHooks,
};
