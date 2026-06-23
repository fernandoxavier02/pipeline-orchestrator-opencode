'use strict';

const {
  CORRUPT_SENTINEL,
  findActiveSentinelState,
} = require('../state/sentinel-state-inspector.cjs');
const checkpoint = require('../lib/checkpoint-verdict.cjs');
const failures = require('../lib/consecutive-failure-counter.cjs');
const {
  canonicalAgentLeaf,
  projectDirFromInput,
  rawAgentNameFromInput,
} = require('./step-ledger-gate.cjs');

const BEFORE_HOOK_MARKER = Symbol.for('pipeline-orchestrator.checkpoint-verdict.tool.execute.before.processed');

function normalizeToolName(toolName) {
  return String(toolName || '').trim().toLowerCase();
}

function loadActiveState(projectDir, options = {}) {
  const reader = options.findActiveSentinelState || findActiveSentinelState;
  try { return reader(projectDir); } catch { return null; }
}

function isGoverned(agentLeaf) {
  return !!(
    agentLeaf &&
    (checkpoint.BLOCKED_WHEN_RED.has(agentLeaf) || failures.BLOCKED_WHEN_TRIPPED.has(agentLeaf))
  );
}

function buildCorruptReason(agentLeaf) {
  return `CHECKPOINT_STATE_CORRUPT: sentinel-state is unreadable, so checkpoint verdict is not trustworthy and ${agentLeaf} is blocked.`;
}

function enforceMode() {
  return process.env.PIPELINE_CHECKPOINT_VERDICT_ENFORCEMENT || 'deny';
}

function withCode(code, decision) {
  if (decision.decision === 'allow' && !decision.warn) return decision;
  return { code, ...decision };
}

function decideCheckpointVerdictGate(ctx) {
  if (!ctx || typeof ctx !== 'object') return { decision: 'allow' };
  if (normalizeToolName(ctx.toolName) !== 'task') return { decision: 'allow' };
  if (!ctx.projectDir) return { decision: 'allow' };

  const agentLeaf = canonicalAgentLeaf(ctx.agentName);
  if (!isGoverned(agentLeaf)) return { decision: 'allow' };

  const state = ctx.state;
  if (!state) return { decision: 'allow' };
  const enforce = enforceMode();

  if (state === CORRUPT_SENTINEL) {
    return { decision: 'block', code: 'CHECKPOINT_STATE_CORRUPT', reason: buildCorruptReason(agentLeaf) };
  }

  if (state.pipeline_active !== true) return { decision: 'allow' };

  const a2 = failures.decideConsecutiveFailures({
    agentLeaf,
    failures: Number.isFinite(state.consecutive_checkpoint_failures) ? state.consecutive_checkpoint_failures : 0,
    enforce,
  });
  if (a2.decision === 'block' || a2.warn) return withCode('STOP_RULE', a2);

  const a1 = checkpoint.decideCheckpointVerdict({
    agentLeaf,
    lastVerdict: checkpoint.normalizeVerdict(state.last_checkpoint_verdict),
    enforce,
  });
  if (a1.decision === 'block' || a1.warn) return withCode('CHECKPOINT_RED', a1);
  return a1;
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
  const result = decideCheckpointVerdictGate(gatherContext(input, options));
  if (result.decision === 'block') {
    output.error = {
      code: result.code || 'CHECKPOINT_VERDICT_BLOCKED',
      reason: result.reason,
      lastVerdict: result.lastVerdict,
      failures: result.failures,
      max: result.max,
    };
  } else if (result.warn) {
    output.warning = {
      code: result.code || 'CHECKPOINT_VERDICT_WARNING',
      lastVerdict: result.lastVerdict,
      failures: result.failures,
      max: result.max,
    };
  }
  if (typeof options.audit === 'function') options.audit({ type: `checkpoint-verdict.${result.decision}`, result });
  return output;
}

function createCheckpointVerdictGateHooks(options = {}) {
  return {
    'tool.execute.before': (input, output = {}) => handleToolExecuteBefore(input, output, options),
  };
}

module.exports = {
  BEFORE_HOOK_MARKER,
  normalizeToolName,
  loadActiveState,
  isGoverned,
  buildCorruptReason,
  gatherContext,
  decideCheckpointVerdictGate,
  handleToolExecuteBefore,
  createCheckpointVerdictGateHooks,
};
