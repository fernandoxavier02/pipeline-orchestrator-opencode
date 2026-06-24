'use strict';

const {
  CORRUPT_SENTINEL,
  discoverStatePath,
  findActiveSentinelState,
} = require('../state/sentinel-state-inspector.cjs');
const {
  canonicalAgentLeaf,
  projectDirFromInput,
  rawAgentNameFromInput,
} = require('./step-ledger-gate.cjs');

const BEFORE_HOOK_MARKER = Symbol.for('pipeline-orchestrator.sentinel.tool.execute.before.processed');
const BOOTSTRAP_AGENTS = Object.freeze(new Set(['task-orchestrator', 'pipeline-controller', 'pipeline-run-orchestrator']));

function normalizeToolName(toolName) {
  return String(toolName || '').trim().toLowerCase();
}

function isAgentTool(input) {
  const toolName = normalizeToolName(input && (input.tool || input.toolName || input.tool_name));
  return toolName === 'task' || toolName === 'agent';
}

function agentLeafFromInput(input) {
  return canonicalAgentLeaf(rawAgentNameFromInput(input));
}

function isPipelineAgent(agentLeaf) {
  return typeof agentLeaf === 'string' && agentLeaf.startsWith('pipeline-')
    || ['task-orchestrator', 'information-gate', 'plan-architect', 'pre-tester', 'executor-controller', 'final-validator'].includes(agentLeaf);
}

function loadActiveState(projectDir, options = {}) {
  const reader = options.findActiveSentinelState || findActiveSentinelState;
  const discover = options.discoverStatePath || discoverStatePath;
  try {
    const discovered = discover(projectDir);
    if (discovered && discovered.statePath && discovered.authoritative === false) return CORRUPT_SENTINEL;
  } catch (_) {
    return CORRUPT_SENTINEL;
  }
  try { return reader(projectDir); } catch (_) { return null; }
}

function expectedListFromState(state) {
  const raw = state && (state.expected_next || state.expectedNext);
  return (Array.isArray(raw) ? raw : [raw])
    .map((value) => canonicalAgentLeaf(value))
    .filter(Boolean);
}

function matchesExpected(agentLeaf, expectedList) {
  return expectedList.some((expected) => agentLeaf === expected);
}

function expectedReason(expectedList) {
  return expectedList.length > 0 ? expectedList.join(', ') : '(missing expected_next)';
}

function decideSentinel(ctx) {
  if (!ctx || typeof ctx !== 'object') return { decision: 'allow' };
  if (!isAgentTool(ctx.input)) return { decision: 'allow' };
  const agentLeaf = ctx.agentLeaf;
  if (!agentLeaf || !isPipelineAgent(agentLeaf) || agentLeaf === 'sentinel') return { decision: 'allow' };

  if (!ctx.state) {
    if (BOOTSTRAP_AGENTS.has(agentLeaf)) return { decision: 'allow' };
    return {
      decision: 'block',
      code: 'SENTINEL_STATE_MISSING',
      reason: `SENTINEL_STATE_MISSING: ${agentLeaf} requires active sentinel-state before dispatch.`,
    };
  }

  if (ctx.state === CORRUPT_SENTINEL) {
    return {
      decision: 'block',
      code: 'SENTINEL_STATE_CORRUPT',
      reason: 'SENTINEL_STATE_CORRUPT: active sentinel-state is unreadable, so pipeline agent dispatch is blocked.',
    };
  }

  if (ctx.state.pipeline_active !== true) return { decision: 'allow' };
  const expectedList = expectedListFromState(ctx.state);
  if (expectedList.length === 0) {
    return {
      decision: 'block',
      code: 'SENTINEL_CHECKPOINT_MISSING_EXPECTED_NEXT',
      reason: `SENTINEL_CHECKPOINT_MISSING_EXPECTED_NEXT: ${agentLeaf} reached a sentinel checkpoint without expected_next.`,
      expected: expectedList,
      agent: agentLeaf,
    };
  }
  if (matchesExpected(agentLeaf, expectedList)) return { decision: 'allow' };
  return {
    decision: 'block',
    code: 'SENTINEL_DIVERGENCE',
    reason: `SENTINEL_DIVERGENCE: attempted ${agentLeaf}; expected ${expectedReason(expectedList)}.`,
    expected: expectedList,
    agent: agentLeaf,
  };
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
    input,
    options,
    projectDir,
    agentLeaf: agentLeafFromInput(input),
    state: projectDir ? loadActiveState(projectDir, options) : null,
  };
}

function handleToolExecuteBefore(input, output = {}, options = {}) {
  if (!markOnce(output)) return output;
  if (output.error) return output;
  const result = decideSentinel(gatherContext(input, options));
  if (result.decision === 'block') {
    output.error = {
      code: result.code || 'SENTINEL_BLOCKED',
      reason: result.reason,
      expected: result.expected,
      agent: result.agent,
    };
  }
  if (typeof options.audit === 'function') {
    try { options.audit({ type: `sentinel.${result.decision}`, result }); } catch (_) { /* never block */ }
  }
  return output;
}

function createSentinelHooks(options = {}) {
  return {
    'tool.execute.before': (input, output = {}) => handleToolExecuteBefore(input, output, options),
  };
}

module.exports = {
  BEFORE_HOOK_MARKER,
  BOOTSTRAP_AGENTS,
  normalizeToolName,
  isAgentTool,
  agentLeafFromInput,
  isPipelineAgent,
  loadActiveState,
  expectedListFromState,
  matchesExpected,
  expectedReason,
  decideSentinel,
  gatherContext,
  handleToolExecuteBefore,
  createSentinelHooks,
};
