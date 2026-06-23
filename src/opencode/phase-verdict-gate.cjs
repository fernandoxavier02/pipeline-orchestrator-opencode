'use strict';

const {
  CORRUPT_SENTINEL,
  findActiveSentinelState,
} = require('../state/sentinel-state-inspector.cjs');
const guard = require('../lib/phase-verdict-guard.cjs');
const {
  canonicalAgentLeaf,
  projectDirFromInput,
  rawAgentNameFromInput,
} = require('./step-ledger-gate.cjs');

const BEFORE_HOOK_MARKER = Symbol.for('pipeline-orchestrator.phase-verdict.tool.execute.before.processed');
const LOCAL_CLOSEOUT_LEAVES = new Set(['pipeline-validator']);

function normalizeToolName(toolName) {
  return String(toolName || '').trim().toLowerCase();
}

function loadActiveState(projectDir, options = {}) {
  const reader = options.findActiveSentinelState || findActiveSentinelState;
  try { return reader(projectDir); } catch { return null; }
}

function isGoverned(agentLeaf) {
  return !!(agentLeaf && guard.governedLeaves().has(agentLeaf));
}

function buildCorruptReason(agentLeaf) {
  return `PHASE_VERDICT_STATE_CORRUPT: sentinel-state is unreadable, so phase verdicts are not trustworthy and ${agentLeaf} is blocked.`;
}

function enforceMode() {
  return process.env.PIPELINE_PHASE_VERDICT_ENFORCEMENT || 'deny';
}

function decidePhaseVerdictGate(ctx) {
  if (!ctx || typeof ctx !== 'object') return { decision: 'allow' };
  if (normalizeToolName(ctx.toolName) !== 'task') return { decision: 'allow' };
  if (!ctx.projectDir) return { decision: 'allow' };

  const rawLeaf = String(ctx.agentName || '').split(':').pop().trim().toLowerCase();
  const agentLeaf = canonicalAgentLeaf(ctx.agentName);
  const closeoutLeaf = LOCAL_CLOSEOUT_LEAVES.has(rawLeaf) ? 'finishing-branch' : '';
  if (!isGoverned(agentLeaf) && !isGoverned(closeoutLeaf)) return { decision: 'allow' };

  const state = ctx.state;
  if (!state) return { decision: 'allow' };

  if (state === CORRUPT_SENTINEL) {
    return { decision: 'block', code: 'PHASE_VERDICT_STATE_CORRUPT', reason: buildCorruptReason(agentLeaf || closeoutLeaf) };
  }

  if (state.pipeline_active !== true) return { decision: 'allow' };

  const enforce = enforceMode();
  const primary = guard.decidePhaseVerdict({ agentLeaf, state, enforce });
  if (primary.decision === 'block' || primary.warn || !closeoutLeaf) return primary;
  return guard.decidePhaseVerdict({ agentLeaf: closeoutLeaf, state, enforce });
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
  const result = decidePhaseVerdictGate(gatherContext(input, options));
  if (result.decision === 'block') {
    output.error = {
      code: result.code || 'PHASE_VERDICT_BLOCKED',
      reason: result.reason,
    };
  } else if (result.warn) {
    output.warning = {
      code: result.code || 'PHASE_VERDICT_WARNING',
    };
  }
  if (typeof options.audit === 'function') options.audit({ type: `phase-verdict.${result.decision}`, result });
  return output;
}

function createPhaseVerdictGateHooks(options = {}) {
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
  LOCAL_CLOSEOUT_LEAVES,
  gatherContext,
  decidePhaseVerdictGate,
  handleToolExecuteBefore,
  createPhaseVerdictGateHooks,
};
