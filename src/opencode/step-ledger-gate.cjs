'use strict';

const {
  CORRUPT_SENTINEL,
  findActiveSentinelState,
} = require('../state/sentinel-state-inspector.cjs');
const ledger = require('../lib/step-ledger.cjs');
const gateLogGuard = require('../lib/gate-log-guard.cjs');
const fixLoop = require('../lib/fix-loop.cjs');

const BEFORE_HOOK_MARKER = Symbol.for('pipeline-orchestrator.step-ledger.tool.execute.before.processed');
const FIX_LOOP_DEFAULT_MAX = fixLoop.DEFAULT_MAX || 3;

const OPENCODE_AGENT_LEAF_MAP = Object.freeze({
  'pipeline-run-orchestrator': 'task-orchestrator',
  'pipeline-information-gate': 'information-gate',
  'pipeline-planner': 'plan-architect',
  'pipeline-pre-tester': 'pre-tester',
  'pipeline-implementer': 'executor-controller',
  'pipeline-validator': 'final-validator',
});

function workflowKeyFromState(state) {
  if (state && typeof state.workflow_key === 'string' && state.workflow_key) return state.workflow_key;
  if (state && state.task_type === 'Spec') return 'Spec';
  return 'FULL';
}

function normalizeToolName(toolName) {
  return String(toolName || '').trim().toLowerCase();
}

function rawAgentNameFromInput(input) {
  const args = (input && (input.args || input.tool_input)) || {};
  for (const candidate of [args.agentName, args.agent, args.name]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  return '';
}

function canonicalAgentLeaf(rawAgentName) {
  const leaf = String(rawAgentName || '').split(':').pop().trim().toLowerCase();
  if (!leaf) return '';
  return OPENCODE_AGENT_LEAF_MAP[leaf] || leaf;
}

function projectDirFromInput(input, options = {}) {
  if (typeof options.projectDir === 'function') return options.projectDir(input);
  if (typeof options.projectDir === 'string' && options.projectDir) return options.projectDir;
  if (input && typeof input.cwd === 'string' && input.cwd) return input.cwd;
  if (input && typeof input.directory === 'string' && input.directory) return input.directory;
  return null;
}

function isGovernedOnCorruptState(agentLeaf) {
  return !!(
    agentLeaf &&
    gateLogGuard.REQUIRED_GATES_BEFORE &&
    Object.prototype.hasOwnProperty.call(gateLogGuard.REQUIRED_GATES_BEFORE, agentLeaf)
  );
}

function buildCorruptReason(agentLeaf) {
  return `STEP_LEDGER_STATE_CORRUPT: sentinel-state is unreadable, so the step ledger is not trustworthy and ${agentLeaf} is blocked.`;
}

function loadActiveState(projectDir, options = {}) {
  const reader = options.findActiveSentinelState || findActiveSentinelState;
  try { return reader(projectDir); } catch { return null; }
}

function decideStepLedgerGate(ctx) {
  if (!ctx || typeof ctx !== 'object') return { decision: 'allow' };
  if (normalizeToolName(ctx.toolName) !== 'task') return { decision: 'allow' };
  if (!ctx.projectDir) return { decision: 'allow' };

  const agentLeaf = canonicalAgentLeaf(ctx.agentName);
  if (!agentLeaf) return { decision: 'allow' };

  const state = ctx.state;
  if (!state) return { decision: 'allow' };
  const enforce = 'deny';

  if (state === CORRUPT_SENTINEL) {
    if (!isGovernedOnCorruptState(agentLeaf)) return { decision: 'allow' };
    return { decision: 'block', code: 'STEP_LEDGER_STATE_CORRUPT', reason: buildCorruptReason(agentLeaf) };
  }

  if (state.pipeline_active !== true) return { decision: 'allow' };

  if (agentLeaf === 'executor-fix') {
    const stateMax = (Number.isFinite(state.fix_loop_max) && state.fix_loop_max > 0)
      ? state.fix_loop_max
      : FIX_LOOP_DEFAULT_MAX;
    return fixLoop.decideFixLoop({
      attempts: Number.isFinite(state.fix_loop_attempts) ? state.fix_loop_attempts : 0,
      max: Math.min(stateMax, FIX_LOOP_DEFAULT_MAX),
      enforce: 'deny',
    });
  }

  if (!Array.isArray(state.step_ledger)) return { decision: 'allow' };

  const decision = ledger.decideAgentSpawn({
    workflowKey: workflowKeyFromState(state),
    agentType: agentLeaf,
    stampedSteps: state.step_ledger,
    enforce,
  });
  if (decision.decision === 'block') return { code: 'STEP_LEDGER_VIOLATION', ...decision };
  if (decision.warn) return { code: 'STEP_LEDGER_VIOLATION', ...decision };
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
  const result = decideStepLedgerGate(gatherContext(input, options));
  if (result.decision === 'block') {
    output.error = { code: result.code || 'STEP_LEDGER_BLOCKED', reason: result.reason, missing: result.missing };
  } else if (result.warn) {
    output.warning = { code: result.code || 'STEP_LEDGER_WARNING', reason: result.reason, missing: result.missing };
  }
  if (typeof options.audit === 'function') options.audit({ type: `step-ledger.${result.decision}`, result });
  return output;
}

function createStepLedgerGateHooks(options = {}) {
  return {
    'tool.execute.before': (input, output = {}) => handleToolExecuteBefore(input, output, options),
  };
}

module.exports = {
  BEFORE_HOOK_MARKER,
  FIX_LOOP_DEFAULT_MAX,
  OPENCODE_AGENT_LEAF_MAP,
  workflowKeyFromState,
  rawAgentNameFromInput,
  canonicalAgentLeaf,
  projectDirFromInput,
  isGovernedOnCorruptState,
  buildCorruptReason,
  loadActiveState,
  gatherContext,
  decideStepLedgerGate,
  handleToolExecuteBefore,
  createStepLedgerGateHooks,
};
