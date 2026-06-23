'use strict';

const {
  CORRUPT_SENTINEL,
  findActiveSentinelState,
  findLivePendingBlock,
  getActiveExecWindow,
  getActiveLock,
  isExemptPath,
  resolveHandshakeTimeoutMs,
} = require('../state/sentinel-state-inspector.cjs');
const {
  canonicalAgentLeaf,
  projectDirFromInput,
  rawAgentNameFromInput,
} = require('./step-ledger-gate.cjs');

const BEFORE_HOOK_MARKER = Symbol.for('pipeline-orchestrator.dispatch-pending.tool.execute.before.processed');
const RESOLUTION_MARKERS = Object.freeze(['DISPATCH_RESULTS', 'GATE_RESPONSES', 'PLAN_MODE_RESULTS']);
const FILE_PATH_TOOLS = Object.freeze(new Set(['read', 'edit', 'write', 'multiedit', 'multi_edit', 'notebookedit', 'notebook_edit']));
const ALWAYS_ALLOW_TOOLS = Object.freeze(new Set([
  'question',
  'todowrite',
  'plan',
  'enterplanmode',
  'exitplanmode',
  'taskcreate',
  'taskupdate',
  'tasklist',
  'taskget',
  'taskoutput',
  'taskstop',
  'schedulewakeup',
]));

function normalizeToolName(toolName) {
  return String(toolName || '').trim().toLowerCase();
}

function loadActiveState(projectDir, options = {}) {
  const reader = options.findActiveSentinelState || findActiveSentinelState;
  try { return reader(projectDir); } catch { return null; }
}

function filePathFromInput(input) {
  const args = (input && (input.args || input.tool_input)) || {};
  return args.filePath || args.file_path || args.path || '';
}

function promptFromInput(input) {
  const args = (input && (input.args || input.tool_input)) || {};
  return typeof args.prompt === 'string' ? args.prompt : '';
}

function hasResolutionMarker(input) {
  const prompt = promptFromInput(input).trim();
  return RESOLUTION_MARKERS.some((marker) => prompt.startsWith(marker));
}

function hasResolutionForPending(input, pending) {
  if (!hasResolutionMarker(input)) return false;
  const id = pendingId(pending);
  if (id === '(unknown)') return false;
  const prompt = promptFromInput(input).trim();
  for (const marker of RESOLUTION_MARKERS) {
    if (!prompt.startsWith(marker)) continue;
    let rest = prompt.slice(marker.length).trim();
    if (rest.startsWith(':')) rest = rest.slice(1).trim();
    const token = rest.split(/\s+/)[0].replace(/:$/, '').toLowerCase();
    return token === id.toLowerCase();
  }
  return false;
}

function pendingId(pending) {
  return (pending && typeof pending.gate_id === 'string' && pending.gate_id)
    || (pending && typeof pending.dispatch_id === 'string' && pending.dispatch_id)
    || (pending && typeof pending.plan_id === 'string' && pending.plan_id)
    || '(unknown)';
}

function isTargetDispatch(input, pending) {
  if (normalizeToolName(input && (input.tool || input.toolName || input.tool_name)) !== 'task') return false;
  const rawTarget = String(rawAgentNameFromInput(input) || '').split(':').pop().trim().toLowerCase();
  const target = canonicalAgentLeaf(rawAgentNameFromInput(input));
  const dispatchTargets = ['dispatch_id', 'target_agent', 'agent', 'subagent_type']
    .map((key) => (pending && typeof pending[key] === 'string' ? pending[key] : ''))
    .map((value) => String(value || '').split(':').pop().trim().toLowerCase())
    .filter(Boolean);
  return [rawTarget, target].some((candidate) => candidate && dispatchTargets.includes(candidate));
}

function isAllowedControlOrResolution(input, pending) {
  const toolName = normalizeToolName(input && (input.tool || input.toolName || input.tool_name));
  if (!toolName) return true;
  if (ALWAYS_ALLOW_TOOLS.has(toolName)) return true;
  if (toolName === 'task' && (hasResolutionForPending(input, pending) || isTargetDispatch(input, pending))) return true;
  return false;
}

function isPipelineArtifactAccess(input, projectDir) {
  const toolName = normalizeToolName(input && (input.tool || input.toolName || input.tool_name));
  if (!FILE_PATH_TOOLS.has(toolName)) return false;
  const filePath = filePathFromInput(input);
  if (typeof filePath !== 'string' || !filePath) return false;
  try { return isExemptPath(filePath, projectDir); } catch (_) { return false; }
}

function hasActiveExecWindow(projectDir) {
  try {
    const lock = getActiveLock(projectDir);
    return !!(lock && getActiveExecWindow(projectDir, lock.session_id));
  } catch (_) {
    return false;
  }
}

function buildReason(pending, toolName) {
  const id = pendingId(pending);
  return `INLINE_WORK_BLOCKED: live ${pending.block_type} pending (${id}); resolve it before using ${toolName}.`;
}

function decideDispatchPendingGate(ctx) {
  if (!ctx || typeof ctx !== 'object') return { decision: 'allow' };
  if (!ctx.projectDir) return { decision: 'allow' };
  const toolName = normalizeToolName(ctx.toolName);
  if (!toolName) return { decision: 'allow' };

  const state = ctx.state;
  if (!state) return { decision: 'allow' };

  if (state === CORRUPT_SENTINEL) {
    if (isAllowedControlOrResolution(ctx.input, null) || isPipelineArtifactAccess(ctx.input, ctx.projectDir) || hasActiveExecWindow(ctx.projectDir)) return { decision: 'allow' };
    return { decision: 'block', code: 'DISPATCH_PENDING_STATE_CORRUPT', reason: `DISPATCH_PENDING_STATE_CORRUPT: sentinel-state is unreadable, so ${toolName} is blocked until state is repaired.` };
  }

  if (state.pipeline_active !== true) return { decision: 'allow' };

  const pending = findLivePendingBlock(state, ctx.handshakeTimeoutMs);
  if (!pending) return { decision: 'allow' };
  if (isAllowedControlOrResolution(ctx.input, pending)) return { decision: 'allow' };
  if (hasActiveExecWindow(ctx.projectDir)) return { decision: 'allow' };
  if (isPipelineArtifactAccess(ctx.input, ctx.projectDir)) return { decision: 'allow' };

  const id = pendingId(pending);
  if (String(process.env.PIPELINE_DISPATCH_INLINE_ENFORCEMENT || 'deny').toLowerCase() === 'warn') {
    return { decision: 'allow', warn: true, code: 'INLINE_WORK_BLOCKED', pendingId: id, pendingType: pending.block_type };
  }

  return { decision: 'block', code: 'INLINE_WORK_BLOCKED', reason: buildReason(pending, toolName), pendingId: id, pendingType: pending.block_type };
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
    toolName: input && (input.tool || input.toolName || input.tool_name),
    projectDir,
    state: projectDir ? loadActiveState(projectDir, options) : null,
    handshakeTimeoutMs: Number.isFinite(options.handshakeTimeoutMs) ? options.handshakeTimeoutMs : resolveHandshakeTimeoutMs(),
  };
}

function inputWithOutputArgs(input, output = {}) {
  if (!output || typeof output !== 'object' || !output.args || typeof output.args !== 'object') return input;
  const inputArgs = (input && (input.args || input.tool_input)) || {};
  return { ...input, args: { ...inputArgs, ...output.args } };
}

function handleToolExecuteBefore(input, output = {}, options = {}) {
  if (!markOnce(output)) return output;
  if (output.error) return output;
  const result = decideDispatchPendingGate(gatherContext(inputWithOutputArgs(input, output), options));
  if (result.decision === 'block') {
    output.error = {
      code: result.code || 'DISPATCH_PENDING_BLOCKED',
      reason: result.reason,
      pendingId: result.pendingId,
      pendingType: result.pendingType,
    };
  } else if (result.warn) {
    output.warning = {
      code: result.code || 'DISPATCH_PENDING_WARNING',
      pendingId: result.pendingId,
      pendingType: result.pendingType,
    };
  }
  if (typeof options.audit === 'function') options.audit({ type: `dispatch-pending.${result.decision}`, result });
  return output;
}

function createDispatchPendingGateHooks(options = {}) {
  return {
    'tool.execute.before': (input, output = {}) => handleToolExecuteBefore(input, output, options),
  };
}

module.exports = {
  BEFORE_HOOK_MARKER,
  RESOLUTION_MARKERS,
  FILE_PATH_TOOLS,
  ALWAYS_ALLOW_TOOLS,
  normalizeToolName,
  loadActiveState,
  filePathFromInput,
  promptFromInput,
  hasResolutionMarker,
  hasResolutionForPending,
  pendingId,
  isTargetDispatch,
  isAllowedControlOrResolution,
  isPipelineArtifactAccess,
  hasActiveExecWindow,
  buildReason,
  gatherContext,
  inputWithOutputArgs,
  decideDispatchPendingGate,
  handleToolExecuteBefore,
  createDispatchPendingGateHooks,
};
