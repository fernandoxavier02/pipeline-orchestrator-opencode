'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  CORRUPT_SENTINEL,
  discoverStatePath,
  findActiveSentinelState,
} = require('../state/sentinel-state-inspector.cjs');
const signer = require('../lib/sentinel-state-signer.cjs');
const { projectDirFromInput } = require('./step-ledger-gate.cjs');

const BEFORE_HOOK_MARKER = Symbol.for('pipeline-orchestrator.parallel-dispatch.tool.execute.before.processed');
const CONCURRENCY_WINDOW_MS = 5000;
const ISO_8601_PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function normalizeToolName(toolName) {
  return String(toolName || '').trim().toLowerCase();
}

function argsFromInput(input, output = {}) {
  const args = (input && (input.args || input.tool_input)) || {};
  const outputArgs = (output && output.args && typeof output.args === 'object') ? output.args : {};
  const topLevel = {};
  for (const key of ['agentName', 'agent', 'name', 'subagent_type']) {
    if (input && typeof input[key] === 'string') topLevel[key] = input[key];
  }
  return { ...topLevel, ...args, ...outputArgs };
}

function rawAgentNameFromInput(input, output = {}) {
  const args = argsFromInput(input, output);
  for (const candidate of [args.agentName, args.agent, args.name, args.subagent_type]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return '';
}

function sanitizeForReason(value, max = 80) {
  return String(value == null ? '' : value).slice(0, max).replace(/[^\x20-\x7E]/g, '');
}

function appendProtocolEvent(runDir, event, nowIso) {
  try {
    const line = JSON.stringify({ ...event, ts: nowIso || new Date().toISOString() }).replace(/[\r\n]+/g, ' ');
    fs.appendFileSync(path.join(runDir, 'protocol-events.jsonl'), `${line}\n`);
    return true;
  } catch (_) {
    return false;
  }
}

function loadActiveState(projectDir, options = {}) {
  const reader = options.findActiveSentinelState || findActiveSentinelState;
  try { return reader(projectDir); } catch (_) { return null; }
}

function stateStronglyTrusted(projectDir, options = {}) {
  if (typeof options.stateStronglyTrusted === 'function') return !!options.stateStronglyTrusted(projectDir);
  if (typeof options.stateStronglyTrusted === 'boolean') return options.stateStronglyTrusted;
  try {
    const discovered = discoverStatePath(projectDir);
    const statePath = discovered && discovered.statePath;
    if (!statePath) return false;
    const { verification } = signer.readVerifiedState(statePath);
    return !!(verification && verification.valid === true && verification.unsigned !== true && verification.key_unavailable !== true);
  } catch (_) {
    return false;
  }
}

function activeRunDir(projectDir, options = {}) {
  if (typeof options.runDir === 'function') return options.runDir(projectDir);
  if (typeof options.runDir === 'string' && options.runDir) return options.runDir;
  try {
    const discovered = discoverStatePath(projectDir);
    return discovered && discovered.statePath ? path.dirname(discovered.statePath) : null;
  } catch (_) {
    return null;
  }
}

function isAgentTool(input) {
  const toolName = normalizeToolName(input && (input.tool || input.toolName || input.tool_name));
  return toolName === 'task' || toolName === 'agent';
}

function agentLeaf(name) {
  return String(name || '').split(':').pop().trim().toLowerCase();
}

function isPipelineAgentName(name) {
  const normalized = String(name || '').trim().toLowerCase();
  return normalized.startsWith('pipeline-') || normalized.startsWith('pipeline-orchestrator:');
}

function isArmedGroupMember(agentName, ids) {
  const raw = String(agentName || '').trim();
  const leaf = agentLeaf(raw);
  const allowLeafMatch = isPipelineAgentName(raw);
  return ids.some((id) => {
    if (typeof id !== 'string' || !id.trim()) return false;
    const expected = id.trim();
    if (expected === raw) return true;
    if (!allowLeafMatch) return false;
    const expectedLeaf = agentLeaf(expected);
    return !!leaf && (expectedLeaf === leaf || expected === leaf || raw === expectedLeaf);
  });
}

function enforcementMode() {
  return String(process.env.PIPELINE_PARALLEL_ENFORCEMENT || 'warn').trim().toLowerCase();
}

function decideParallelDispatchGate(ctx) {
  if (!ctx || typeof ctx !== 'object') return { decision: 'allow' };
  if (!isAgentTool(ctx.input)) return { decision: 'allow' };
  if (!ctx.projectDir) return { decision: 'allow' };

  const state = ctx.state;
  if (!state || state === CORRUPT_SENTINEL) return { decision: 'allow' };
  if (state.pipeline_active !== true) return { decision: 'allow' };

  const expected = state.parallel_dispatch_expected;
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) return { decision: 'allow' };

  const groupId = sanitizeForReason(expected.group_id, 64) || '(none)';
  const ids = expected.dispatch_ids;
  if (!Array.isArray(ids)) {
    return {
      decision: 'allow',
      warn: true,
      code: 'PARALLEL_DISPATCH_MALFORMED',
      event: 'PARALLEL_DISPATCH_MALFORMED',
      reason: `PARALLEL_DISPATCH_MALFORMED: dispatch_ids is not an array for group '${groupId}'.`,
      groupId,
    };
  }
  if (ids.length === 0) return { decision: 'allow' };

  const armedTs = (typeof expected.armed_ts === 'string' && ISO_8601_PREFIX.test(expected.armed_ts)) ? Date.parse(expected.armed_ts) : NaN;
  const age = Number.isFinite(armedTs) ? ((ctx.nowMs || Date.now()) - armedTs) : NaN;
  if (!Number.isFinite(age)) return { decision: 'allow' };

  const agentName = rawAgentNameFromInput(ctx.input);
  if (isArmedGroupMember(agentName, ids)) return { decision: 'allow' };

  const inWindow = age >= 0 && age <= CONCURRENCY_WINDOW_MS;
  const timing = inWindow ? 'within concurrency window' : 'past concurrency window';
  const reason = `PARALLEL_DISPATCH_VIOLATION: '${sanitizeForReason(agentName) || '(unknown)'}' was dispatched outside armed group '${groupId}' (${timing}).`;
  if (enforcementMode() === 'deny' && ctx.stateStronglyTrusted === true) {
    return { decision: 'block', code: 'PARALLEL_DISPATCH_VIOLATION', reason, groupId, agentName, event: 'PARALLEL_DISPATCH_VIOLATION' };
  }
  return {
    decision: 'allow',
    warn: true,
    code: 'PARALLEL_DISPATCH_VIOLATION',
    reason,
    groupId,
    agentName,
    event: 'PARALLEL_DISPATCH_VIOLATION',
    denySuppressed: enforcementMode() === 'deny',
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
    projectDir,
    state: projectDir ? loadActiveState(projectDir, options) : null,
    stateStronglyTrusted: projectDir ? stateStronglyTrusted(projectDir, options) : false,
    nowMs: options.nowMs,
  };
}

function auditResult(input, output, result, options = {}) {
  if (!result || !result.event) return true;
  const projectDir = projectDirFromInput(input, options);
  const runDir = projectDir ? activeRunDir(projectDir, options) : null;
  if (!runDir) return false;
  const writer = typeof options.appendProtocolEvent === 'function' ? options.appendProtocolEvent : appendProtocolEvent;
  return writer(runDir, {
    event: result.event,
    agent: sanitizeForReason(result.agentName || rawAgentNameFromInput(input, output)) || 'parent',
    phase: 'pre-dispatch',
    detail: result.reason,
    decided_by: 'parallel-dispatch-gate',
  }, options.nowIso);
}

function handleToolExecuteBefore(input, output = {}, options = {}) {
  if (!markOnce(output)) return output;
  if (output.error) return output;
  const result = decideParallelDispatchGate(gatherContext({ ...input, args: argsFromInput(input, output) }, options));
  const audited = auditResult(input, output, result, options);
  if (result.decision === 'block') {
    output.error = { code: result.code, reason: result.reason, groupId: result.groupId, auditFailed: audited === false };
  } else if (result.warn) {
    output.warning = { code: result.code, reason: result.reason, groupId: result.groupId, auditFailed: audited === false, denySuppressed: result.denySuppressed === true };
  }
  if (typeof options.audit === 'function') options.audit({ type: `parallel-dispatch.${result.decision}`, result });
  return output;
}

function createParallelDispatchGateHooks(options = {}) {
  return {
    'tool.execute.before': (input, output = {}) => handleToolExecuteBefore(input, output, options),
  };
}

module.exports = {
  BEFORE_HOOK_MARKER,
  CONCURRENCY_WINDOW_MS,
  ISO_8601_PREFIX,
  normalizeToolName,
  argsFromInput,
  rawAgentNameFromInput,
  sanitizeForReason,
  appendProtocolEvent,
  loadActiveState,
  stateStronglyTrusted,
  activeRunDir,
  isAgentTool,
  agentLeaf,
  isPipelineAgentName,
  isArmedGroupMember,
  enforcementMode,
  decideParallelDispatchGate,
  gatherContext,
  auditResult,
  handleToolExecuteBefore,
  createParallelDispatchGateHooks,
};
