'use strict';

const path = require('node:path');
const { isPlanGateArmed } = require('../validators/contract-validator.cjs');
const { detectShellWrite } = require('./detect-shell-write.cjs');

const PHASE_ORDER = Object.freeze(['planned', 'red', 'green', 'prompt', 'review', 'verdict']);
const WRITE_TOOLS = Object.freeze(new Set(['edit', 'write']));
const BEFORE_HOOK_MARKER = Symbol.for('pipeline-orchestrator.guard.tool.execute.before.processed');
const AFTER_HOOK_MARKER = Symbol.for('pipeline-orchestrator.guard.tool.execute.after.processed');

function isInsideAllowedSurface(filePath, allowedSurfaces) {
  const attempted = path.resolve(filePath);
  return allowedSurfaces.some((surface) => {
    const relative = path.relative(path.resolve(surface), attempted);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  });
}

function block(code, extra) {
  return { ok: false, code, ...extra };
}

// B3: Plan-Mode gate verdict for an activeRun. armed = required && !approved; invalid = malformed
// planGate (fail-closed). Absent planGate → not armed (legacy/back-compat).
function planGateVerdict(activeRun) {
  const pg = activeRun.planGate;
  if (pg === undefined || pg === null) return { armed: false, invalid: false };
  if (typeof pg !== 'object' || typeof pg.required !== 'boolean' || typeof pg.approved !== 'boolean') {
    return { armed: false, invalid: true };
  }
  return { armed: isPlanGateArmed(activeRun), invalid: false };
}

function guardToolExecution({ activeRun, toolName, args }) {
  if (!activeRun) return { ok: true };

  // Plan-Mode gate (B3): no production write (edit/write) and no terminal write (bash write-command)
  // without an APPROVED plan. Mirrors the Claude Code shouldBlockWithoutApprovedPlan + terminal guard.
  const isWriteTool = WRITE_TOOLS.has(toolName);
  const isShellWrite = toolName === 'bash' && detectShellWrite(args && args.command);
  if (isWriteTool || isShellWrite) {
    const v = planGateVerdict(activeRun);
    if (v.invalid) return block('PLAN_GATE_INVALID', { reason: 'planGate malformed — failing closed' });
    if (v.armed) {
      return (isShellWrite && !isWriteTool)
        ? block('PLAN_GATE_TERMINAL_BLOCKED', { reason: 'shell write blocked — no approved plan registered for this run' })
        : block('PLAN_GATE_ACTIVE', { reason: 'no approved plan registered — get the plan approved before writing code' });
    }
  }

  if (isWriteTool) {
    const attemptedScope = args && (args.filePath || args.path);
    if (!attemptedScope || !isInsideAllowedSurface(attemptedScope, activeRun.allowedSurfaces || [])) {
      return block('WRITE_OUTSIDE_ALLOWED_SCOPE', {
        allowedScope: activeRun.allowedSurfaces || [],
        attemptedScope,
      });
    }
  }

  if (toolName === 'phase.transition') {
    const fromIndex = PHASE_ORDER.indexOf(args && args.from);
    const toIndex = PHASE_ORDER.indexOf(args && args.to);
    if (fromIndex === -1 || toIndex !== fromIndex + 1) {
      return block('INVALID_PHASE_TRANSITION', { from: args && args.from, to: args && args.to });
    }
  }

  if (toolName === 'task' && (!args || !args.contextPacket)) {
    return block('DISPATCH_CONTEXT_REQUIRED', { agentName: args && args.agentName });
  }

  return { ok: true };
}

function markOnce(target, marker) {
  if (target[marker]) return false;
  Object.defineProperty(target, marker, { value: true, enumerable: false, configurable: false });
  return true;
}

function createPipelineGuardHooks({ getActiveRun, audit }) {
  return {
    'tool.execute.before': (input, output = {}) => {
      const activeRun = getActiveRun();
      if (!activeRun) return;
      if (!markOnce(output, BEFORE_HOOK_MARKER)) return;
      const result = guardToolExecution({
        activeRun,
        toolName: input.tool,
        args: input.args || {},
      });
      if (!result.ok) {
        output.error = result;
        audit({ type: 'tool.blocked', result });
        return;
      }
      audit({ type: 'tool.allowed', toolName: input.tool });
    },
    'tool.execute.after': (input) => {
      if (!markOnce(input, AFTER_HOOK_MARKER)) return;
      audit({ type: 'tool.completed', toolName: input.tool });
    },
  };
}

module.exports = {
  PHASE_ORDER,
  guardToolExecution,
  createPipelineGuardHooks,
  isInsideAllowedSurface,
  BEFORE_HOOK_MARKER,
  AFTER_HOOK_MARKER,
};
