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
const { detectShellWrite } = require('./detect-shell-write.cjs');
const { projectDirFromInput } = require('./step-ledger-gate.cjs');

const BEFORE_HOOK_MARKER = Symbol.for('pipeline-orchestrator.edit-guard.tool.execute.before.processed');
const FILE_WRITE_TOOLS = Object.freeze(new Set(['edit', 'write', 'multiedit', 'multi_edit', 'notebookedit', 'notebook_edit']));
const SHELL_TOOLS = Object.freeze(new Set(['bash', 'powershell']));

function normalizeToolName(toolName) {
  return String(toolName || '').trim().toLowerCase();
}

function argsFromInput(input) {
  return (input && (input.args || input.tool_input)) || {};
}

function targetPathFromInput(input) {
  const args = argsFromInput(input);
  return args.filePath || args.file_path || args.path || args.notebookPath || args.notebook_path || '';
}

function commandFromInput(input) {
  const args = argsFromInput(input);
  return typeof args.command === 'string' ? args.command : '';
}

function loadActiveState(projectDir, options = {}) {
  const reader = options.findActiveSentinelState || findActiveSentinelState;
  try { return reader(projectDir); } catch (_) { return null; }
}

function pendingId(pending) {
  return (pending && typeof pending.gate_id === 'string' && pending.gate_id)
    || (pending && typeof pending.dispatch_id === 'string' && pending.dispatch_id)
    || (pending && typeof pending.plan_id === 'string' && pending.plan_id)
    || '(unknown)';
}

function pendingBlockReason(pending, toolName) {
  return `INLINE_WORK_BLOCKED: live ${pending.block_type} pending (${pendingId(pending)}); resolve it before using ${toolName}.`;
}

function hasActiveExecWindow(projectDir, options = {}) {
  try {
    const lockReader = options.getActiveLock || getActiveLock;
    const windowReader = options.getActiveExecWindow || getActiveExecWindow;
    const lock = lockReader(projectDir);
    return !!(lock && windowReader(projectDir, lock.session_id));
  } catch (_) {
    return false;
  }
}

function hasActiveSessionLock(projectDir, options = {}) {
  try {
    const lockReader = options.getActiveLock || getActiveLock;
    return !!lockReader(projectDir);
  } catch (_) {
    return false;
  }
}

function isPipelineArtifactPath(projectDir, targetPath) {
  if (typeof targetPath !== 'string' || !targetPath) return false;
  try { return isExemptPath(targetPath, projectDir); } catch (_) { return false; }
}

function isWriteAttempt(ctx) {
  const toolName = normalizeToolName(ctx.toolName);
  if (FILE_WRITE_TOOLS.has(toolName)) return true;
  if (SHELL_TOOLS.has(toolName)) return detectShellWrite(ctx.command);
  return false;
}

function planGateDecision(state, toolName) {
  const planGate = state && state.planGate;
  if (planGate == null) return null;
  if (!planGate || typeof planGate !== 'object' || Array.isArray(planGate) || typeof planGate.required !== 'boolean' || typeof planGate.approved !== 'boolean') {
    return { decision: 'block', code: 'PLAN_GATE_INVALID', reason: 'PLAN_GATE_INVALID: plan gate state is malformed, so writes are blocked.' };
  }
  if (planGate.required !== true || planGate.approved === true) return null;
  if (SHELL_TOOLS.has(normalizeToolName(toolName))) {
    return { decision: 'block', code: 'PLAN_GATE_TERMINAL_BLOCKED', reason: 'PLAN_GATE_TERMINAL_BLOCKED: shell write blocked because the required plan is not approved.' };
  }
  return { decision: 'block', code: 'PLAN_GATE_ACTIVE', reason: 'PLAN_GATE_ACTIVE: write blocked because the required plan is not approved.' };
}

function decideEditGuard(ctx) {
  if (!ctx || typeof ctx !== 'object') return { decision: 'allow' };
  if (!ctx.projectDir) return { decision: 'allow' };
  if (!isWriteAttempt(ctx)) return { decision: 'allow' };

  const toolName = normalizeToolName(ctx.toolName);

  if (ctx.state === CORRUPT_SENTINEL) {
    return { decision: 'block', code: 'EDIT_GUARD_STATE_CORRUPT', reason: `EDIT_GUARD_STATE_CORRUPT: sentinel-state is unreadable, so ${toolName} writes are blocked.` };
  }

  const pending = ctx.state && ctx.state !== CORRUPT_SENTINEL ? findLivePendingBlock(ctx.state, ctx.handshakeTimeoutMs) : null;
  if (pending) {
    return {
      decision: 'block',
      code: 'INLINE_WORK_BLOCKED',
      reason: pendingBlockReason(pending, toolName),
      pendingId: pendingId(pending),
      pendingType: pending.block_type,
    };
  }

  const planGate = planGateDecision(ctx.state, toolName);
  if (planGate) return planGate;

  const hasLock = hasActiveSessionLock(ctx.projectDir, ctx.options);
  const governed = (ctx.state && ctx.state.pipeline_active === true) || hasLock;
  if (!governed) return { decision: 'allow' };
  if (isPipelineArtifactPath(ctx.projectDir, ctx.targetPath)) return { decision: 'allow' };
  if (hasActiveExecWindow(ctx.projectDir, ctx.options)) return { decision: 'allow' };

  if (String(process.env.PIPELINE_EDIT_GUARD_ENFORCEMENT || 'deny').toLowerCase() === 'warn') {
    return { decision: 'allow', warn: true, code: 'EDIT_GUARD_EXEC_WINDOW_REQUIRED' };
  }

  return {
    decision: 'block',
    code: 'EDIT_GUARD_EXEC_WINDOW_REQUIRED',
    reason: `EDIT_GUARD_EXEC_WINDOW_REQUIRED: ${toolName} write requires an active execution window for the governed pipeline run.`,
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
    toolName: input && (input.tool || input.toolName || input.tool_name),
    targetPath: targetPathFromInput(input),
    command: commandFromInput(input),
    state: projectDir ? loadActiveState(projectDir, options) : null,
    handshakeTimeoutMs: Number.isFinite(options.handshakeTimeoutMs) ? options.handshakeTimeoutMs : resolveHandshakeTimeoutMs(),
  };
}

function handleToolExecuteBefore(input, output = {}, options = {}) {
  if (!markOnce(output)) return output;
  if (output.error) return output;
  const result = decideEditGuard(gatherContext(input, options));
  if (result.decision === 'block') {
    output.error = {
      code: result.code || 'EDIT_GUARD_BLOCKED',
      reason: result.reason,
      pendingId: result.pendingId,
      pendingType: result.pendingType,
    };
  } else if (result.warn) {
    output.warning = { code: result.code || 'EDIT_GUARD_WARNING', reason: result.reason };
  }
  if (typeof options.audit === 'function') options.audit({ type: `edit-guard.${result.decision}`, result });
  return output;
}

function createEditGuardHooks(options = {}) {
  return {
    'tool.execute.before': (input, output = {}) => handleToolExecuteBefore(input, output, options),
  };
}

module.exports = {
  BEFORE_HOOK_MARKER,
  FILE_WRITE_TOOLS,
  SHELL_TOOLS,
  normalizeToolName,
  argsFromInput,
  targetPathFromInput,
  commandFromInput,
  loadActiveState,
  pendingId,
  pendingBlockReason,
  hasActiveExecWindow,
  hasActiveSessionLock,
  isPipelineArtifactPath,
  isWriteAttempt,
  planGateDecision,
  decideEditGuard,
  gatherContext,
  handleToolExecuteBefore,
  createEditGuardHooks,
};
