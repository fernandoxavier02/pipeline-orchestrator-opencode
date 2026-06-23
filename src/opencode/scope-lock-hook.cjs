'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  CORRUPT_SENTINEL,
  discoverStatePath,
  findActiveSentinelState,
  getActiveLock,
  isExemptPath,
} = require('../state/sentinel-state-inspector.cjs');
const { projectDirFromInput } = require('./step-ledger-gate.cjs');

const BEFORE_HOOK_MARKER = Symbol.for('pipeline-orchestrator.scope-lock.tool.execute.before.processed');
const LOCKED_WRITE_TOOLS = Object.freeze(new Set(['edit', 'write', 'multiedit', 'multi_edit', 'notebookedit', 'notebook_edit']));
const MAX_PATTERN_LENGTH = 200;

function normalizeToolName(toolName) {
  return String(toolName || '').trim().toLowerCase();
}

function normalizePath(value) {
  if (typeof value !== 'string') return '';
  return value.split(/[\\/]/).join('/').toLowerCase();
}

function targetPathFromInput(input) {
  const args = (input && (input.args || input.tool_input)) || {};
  return args.filePath || args.file_path || args.path || args.notebookPath || args.notebook_path || '';
}

function containedIn(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function realpath(value) {
  const read = fs.realpathSync.native || fs.realpathSync;
  return read(value);
}

function resolveForContainment(filePath) {
  const resolved = path.resolve(filePath);
  const missing = [];
  let current = resolved;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return resolved;
    missing.unshift(path.basename(current));
    current = parent;
  }
  try {
    const base = realpath(current);
    return missing.length > 0 ? path.join(base, ...missing) : base;
  } catch (_) {
    return resolved;
  }
}

function resolvedProjectPath(projectDir, targetPath) {
  if (typeof projectDir !== 'string' || !projectDir || typeof targetPath !== 'string' || !targetPath) return null;
  const base = resolveForContainment(projectDir);
  const resolved = resolveForContainment(path.resolve(projectDir, targetPath));
  return containedIn(base, resolved) ? resolved : null;
}

function targetForms(projectDir, targetPath) {
  const resolved = resolvedProjectPath(projectDir, targetPath);
  if (!resolved) return [];
  return [normalizePath(resolved), normalizePath(path.relative(resolveForContainment(projectDir), resolved))];
}

function globToRegex(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*';
        i += 1;
      } else {
        out += '[^/]*';
      }
      continue;
    }
    out += /[.+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
  }
  return new RegExp(`^${out}$`);
}

function matchesPatternForm(target, pattern) {
  if (typeof target !== 'string' || typeof pattern !== 'string' || !target || !pattern || pattern.length > MAX_PATTERN_LENGTH) return false;
  const p = normalizePath(pattern);
  if (p.includes('*')) return globToRegex(p).test(target);
  return target === p;
}

function matchesPattern(projectDir, targetPath, pattern) {
  return targetForms(projectDir, targetPath).some((form) => matchesPatternForm(form, pattern));
}

function readActiveContract(projectDir, options = {}) {
  const reader = options.getActiveLock || getActiveLock;
  let activeLock;
  try {
    activeLock = reader(projectDir);
  } catch (_) {
    return null;
  }
  const contract = activeLock && activeLock.active_change_contract;
  return contract && typeof contract === 'object' && !Array.isArray(contract) ? contract : null;
}

function runIdFromState(state) {
  return (state && typeof state.runId === 'string' && state.runId) || (state && typeof state.run_id === 'string' && state.run_id) || null;
}

function variantFromState(state) {
  return (state && typeof state.pipeline_variant === 'string' && state.pipeline_variant)
    || (state && typeof state.variant === 'string' && state.variant)
    || '';
}

function readLoggedGates(projectDir, state, options = {}) {
  const discover = options.discoverStatePath || discoverStatePath;
  let statePath = null;
  try {
    const discovered = discover(projectDir);
    statePath = discovered && discovered.statePath;
  } catch (_) {
    statePath = null;
  }
  if (!statePath) return new Set();
  try {
    const gateFile = path.join(path.dirname(statePath), 'gate-decisions.jsonl');
    if (!containedIn(realpath(path.join(projectDir, '.pipeline')), realpath(gateFile))) return new Set();
    const text = fs.readFileSync(gateFile, 'utf8');
    const wantRunId = runIdFromState(state);
    if (!wantRunId) return new Set();
    const out = new Set();
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let record;
      try { record = JSON.parse(trimmed); } catch (_) { continue; }
      const recordRunId = record && (record.run_id || record.runId);
      if (recordRunId !== wantRunId) continue;
      if (typeof record.gate === 'string' && record.gate.trim()) out.add(record.gate.trim());
    }
    return out;
  } catch (_) {
    return new Set();
  }
}

function checkRefactorScopeLock(ctx) {
  const variant = variantFromState(ctx.state);
  if (!/^refactor-/.test(variant)) return null;
  try {
    if (isExemptPath(ctx.targetPath, ctx.projectDir)) return null;
  } catch (_) {
    // If exemption cannot be confirmed, keep the refactor lock active.
  }
  const logged = readLoggedGates(ctx.projectDir, ctx.state, ctx.options);
  if (logged.has('REFACTOR_SCOPE_LOCK')) return null;
  if (String(process.env.PIPELINE_REFACTOR_SCOPE_LOCK_ENFORCEMENT || 'deny').toLowerCase() === 'warn') {
    return { decision: 'allow', warn: true, code: 'REFACTOR_SCOPE_LOCK_MISSING' };
  }
  return {
    decision: 'block',
    code: 'REFACTOR_SCOPE_LOCK_MISSING',
    reason: `REFACTOR_SCOPE_LOCK_MISSING: ${variant} run must record REFACTOR_SCOPE_LOCK before editing production files.`,
  };
}

function checkContractScope({ projectDir, targetPath, contract }) {
  if (!contract) return null;
  if (contract.bootstrap && contract.bootstrap.active === true) return null;
  if (!targetPath) return { decision: 'block', code: 'SCOPE_LOCK_TARGET_MISSING', reason: 'SCOPE_LOCK_TARGET_MISSING: write target path is missing.' };
  const resolvedTarget = resolvedProjectPath(projectDir, targetPath);
  if (!resolvedTarget) {
    return { decision: 'block', code: 'SCOPE_LOCK_PATH_OUTSIDE_PROJECT', reason: 'SCOPE_LOCK_PATH_OUTSIDE_PROJECT: target resolves outside the project.' };
  }

  const forbidden = Array.isArray(contract.forbidden_files) ? contract.forbidden_files : [];
  for (const pattern of forbidden) {
    if (matchesPattern(projectDir, targetPath, pattern)) {
      return { decision: 'block', code: 'SCOPE_LOCK_FORBIDDEN', reason: `SCOPE_LOCK_FORBIDDEN: target matches forbidden_files pattern ${pattern}.`, pattern };
    }
  }

  const allowed = Array.isArray(contract.allowed_files) ? contract.allowed_files : [];
  const allowedNew = Array.isArray(contract.allowed_new_files) ? contract.allowed_new_files : [];
  if (allowed.length === 0 && allowedNew.length === 0) return null;
  const targetExists = fs.existsSync(resolvedTarget);
  const applicable = targetExists ? allowed : allowedNew;
  if (applicable.some((pattern) => matchesPattern(projectDir, targetPath, pattern))) return null;
  return {
    decision: 'block',
    code: 'SCOPE_LOCK_OUTSIDE_ALLOWED',
    reason: 'SCOPE_LOCK_OUTSIDE_ALLOWED: target is not listed in allowed_files or allowed_new_files.',
    allowed: applicable,
  };
}

function loadActiveState(projectDir, options = {}) {
  const reader = options.findActiveSentinelState || findActiveSentinelState;
  try { return reader(projectDir); } catch { return null; }
}

function decideScopeLock(ctx) {
  if (!ctx || typeof ctx !== 'object') return { decision: 'allow' };
  if (!LOCKED_WRITE_TOOLS.has(normalizeToolName(ctx.toolName))) return { decision: 'allow' };
  if (!ctx.projectDir) return { decision: 'allow' };
  if (ctx.state === CORRUPT_SENTINEL) {
    return { decision: 'block', code: 'SCOPE_LOCK_STATE_CORRUPT', reason: 'SCOPE_LOCK_STATE_CORRUPT: active sentinel state is unreadable, so scope cannot be trusted.' };
  }

  if (ctx.state && ctx.state !== CORRUPT_SENTINEL && ctx.state.pipeline_active === true) {
    const refactor = checkRefactorScopeLock(ctx);
    if (refactor) return refactor;
  }

  const contract = ctx.contract || readActiveContract(ctx.projectDir, ctx.options);
  const contractDecision = checkContractScope({ projectDir: ctx.projectDir, targetPath: ctx.targetPath, contract });
  return contractDecision || { decision: 'allow' };
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
    state: projectDir ? loadActiveState(projectDir, options) : null,
    contract: projectDir ? readActiveContract(projectDir, options) : null,
  };
}

function handleToolExecuteBefore(input, output = {}, options = {}) {
  if (!markOnce(output)) return output;
  if (output.error) return output;
  const result = decideScopeLock(gatherContext(input, options));
  if (result.decision === 'block') {
    output.error = { code: result.code || 'SCOPE_LOCK_BLOCKED', reason: result.reason, pattern: result.pattern, allowed: result.allowed };
  } else if (result.warn) {
    output.warning = { code: result.code || 'SCOPE_LOCK_WARNING', reason: result.reason };
  }
  if (typeof options.audit === 'function') options.audit({ type: `scope-lock.${result.decision}`, result });
  return output;
}

function createScopeLockHooks(options = {}) {
  return {
    'tool.execute.before': (input, output = {}) => handleToolExecuteBefore(input, output, options),
  };
}

module.exports = {
  BEFORE_HOOK_MARKER,
  LOCKED_WRITE_TOOLS,
  MAX_PATTERN_LENGTH,
  normalizeToolName,
  normalizePath,
  targetPathFromInput,
  matchesPattern,
  readActiveContract,
  runIdFromState,
  variantFromState,
  readLoggedGates,
  checkRefactorScopeLock,
  checkContractScope,
  gatherContext,
  decideScopeLock,
  handleToolExecuteBefore,
  createScopeLockHooks,
};
