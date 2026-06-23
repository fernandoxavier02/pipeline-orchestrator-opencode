'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  CORRUPT_SENTINEL,
  findActiveSentinelState,
} = require('../state/sentinel-state-inspector.cjs');
const guard = require('../lib/gate-log-guard.cjs');
const {
  canonicalAgentLeaf,
  projectDirFromInput,
  rawAgentNameFromInput,
} = require('./step-ledger-gate.cjs');

const BEFORE_HOOK_MARKER = Symbol.for('pipeline-orchestrator.gate-log.tool.execute.before.processed');
const CORRUPT_GATE_LOG = '__CORRUPT_GATE_LOG__';

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
    guard.REQUIRED_GATES_BEFORE &&
    Object.prototype.hasOwnProperty.call(guard.REQUIRED_GATES_BEFORE, agentLeaf)
  );
}

function buildCorruptReason(agentLeaf) {
  return `GATE_LOG_STATE_CORRUPT: sentinel-state is unreadable, so gate decisions are not trustworthy and ${agentLeaf} is blocked.`;
}

function enforceMode() {
  return process.env.PIPELINE_GATE_LOG_ENFORCEMENT || 'deny';
}

function containedIn(parent, child) {
  const real = fs.realpathSync.native || fs.realpathSync;
  const parentPath = fs.existsSync(parent) ? real(parent) : path.resolve(parent);
  const childPath = fs.existsSync(child) ? real(child) : path.resolve(child);
  const relative = path.relative(parentPath, childPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function samePath(a, b) {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function realPath(filePath) {
  const real = fs.realpathSync.native || fs.realpathSync;
  return real(filePath);
}

function trustedRunDir(projectDir, candidate) {
  if (typeof candidate !== 'string' || !candidate) return null;
  const resolved = path.resolve(projectDir, candidate);
  const docsRoot = path.join(path.resolve(projectDir), '.pipeline', 'docs');
  if (!fs.existsSync(docsRoot) || !samePath(realPath(docsRoot), docsRoot)) return null;
  return containedIn(docsRoot, resolved) ? resolved : null;
}

function trustedGateFile(runDir) {
  const gateFile = path.join(runDir, 'gate-decisions.jsonl');
  if (!fs.existsSync(gateFile)) return null;
  return containedIn(runDir, gateFile) ? gateFile : CORRUPT_GATE_LOG;
}

function activeRunDir(projectDir, state, options = {}) {
  const candidates = [];
  if (typeof options.runDir === 'function') candidates.push(options.runDir(projectDir, state));
  if (typeof options.runDir === 'string' && options.runDir) candidates.push(options.runDir);

  const envDir = typeof process.env.PIPELINE_DOC_PATH === 'string' ? process.env.PIPELINE_DOC_PATH.trim() : '';
  if (envDir) candidates.push(path.isAbsolute(envDir) ? envDir : path.resolve(projectDir, envDir));

  if (state && typeof state.pipeline_doc_path === 'string' && state.pipeline_doc_path) {
    candidates.push(path.isAbsolute(state.pipeline_doc_path) ? state.pipeline_doc_path : path.resolve(projectDir, state.pipeline_doc_path));
  }

  try {
    const pointer = JSON.parse(fs.readFileSync(path.join(projectDir, '.pipeline', 'active-run.json'), 'utf8'));
    if (pointer && typeof pointer.pipeline_doc_path === 'string' && pointer.pipeline_doc_path) candidates.push(pointer.pipeline_doc_path);
  } catch (_) {
    // Fall through to candidate validation.
  }

  for (const candidate of candidates) {
    const trusted = trustedRunDir(projectDir, candidate);
    if (trusted) return trusted;
  }
  return null;
}

function readLoggedGates(projectDir, state, options = {}) {
  const runDir = activeRunDir(projectDir, state, options);
  if (!runDir) return null;
  try {
    const gateFile = trustedGateFile(runDir);
    if (!gateFile) return null;
    if (gateFile === CORRUPT_GATE_LOG) return CORRUPT_GATE_LOG;
    const text = fs.readFileSync(gateFile, 'utf8');
    return guard.parseLoggedGates(text, state && state.runId);
  } catch (_) {
    return null;
  }
}

function decideGateLogGate(ctx) {
  if (!ctx || typeof ctx !== 'object') return { decision: 'allow' };
  if (normalizeToolName(ctx.toolName) !== 'task') return { decision: 'allow' };
  if (!ctx.projectDir) return { decision: 'allow' };

  const agentLeaf = canonicalAgentLeaf(ctx.agentName);
  if (!isGoverned(agentLeaf)) return { decision: 'allow' };

  const state = ctx.state;
  if (!state) return { decision: 'allow' };
  if (state === CORRUPT_SENTINEL) {
    return { decision: 'block', code: 'GATE_LOG_STATE_CORRUPT', reason: buildCorruptReason(agentLeaf) };
  }
  if (state.pipeline_active !== true) return { decision: 'allow' };

  const loggedGates = readLoggedGates(ctx.projectDir, state, ctx.options);
  if (!loggedGates) return { decision: 'allow' };
  if (loggedGates === CORRUPT_GATE_LOG) {
    return { decision: 'block', code: 'GATE_LOG_UNTRUSTED', reason: 'GATE_LOG_UNTRUSTED: gate-decisions.jsonl resolves outside the active run directory.' };
  }
  const decision = guard.decideGateLog({ agentLeaf, loggedGates, enforce: enforceMode() });
  if (decision.decision === 'block' || decision.warn) return { code: 'GATE_LOG_MISSING', ...decision };
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
    options,
  };
}

function handleToolExecuteBefore(input, output = {}, options = {}) {
  if (!markOnce(output)) return output;
  if (output.error) return output;
  const result = decideGateLogGate(gatherContext(input, options));
  if (result.decision === 'block') {
    output.error = {
      code: result.code || 'GATE_LOG_BLOCKED',
      reason: result.reason,
      missing: result.missing,
    };
  } else if (result.warn) {
    output.warning = {
      code: result.code || 'GATE_LOG_WARNING',
      missing: result.missing,
    };
  }
  if (typeof options.audit === 'function') options.audit({ type: `gate-log.${result.decision}`, result });
  return output;
}

function createGateLogGateHooks(options = {}) {
  return {
    'tool.execute.before': (input, output = {}) => handleToolExecuteBefore(input, output, options),
  };
}

module.exports = {
  BEFORE_HOOK_MARKER,
  CORRUPT_GATE_LOG,
  normalizeToolName,
  loadActiveState,
  isGoverned,
  buildCorruptReason,
  containedIn,
  samePath,
  trustedGateFile,
  trustedRunDir,
  activeRunDir,
  readLoggedGates,
  gatherContext,
  decideGateLogGate,
  handleToolExecuteBefore,
  createGateLogGateHooks,
};
