'use strict';

const path = require('node:path');

const { discoverStatePath } = require('../state/sentinel-state-inspector.cjs');
const { readVerifiedState, writeSignedState } = require('../lib/sentinel-state-signer.cjs');
const ledger = require('../lib/step-ledger.cjs');
const { canonicalAgentLeaf, projectDirFromInput, OPENCODE_AGENT_LEAF_MAP } = require('./step-ledger-gate.cjs');

const AFTER_HOOK_MARKER = Symbol.for('pipeline-orchestrator.step-ledger.tool.execute.after.processed');

function workflowKeyFromState(state) {
  if (state && typeof state.workflow_key === 'string' && state.workflow_key) return state.workflow_key;
  if (state && state.task_type === 'Spec') return 'Spec';
  return 'FULL';
}

function hasUsableResult(toolResponse) {
  if (toolResponse == null) return false;
  if (typeof toolResponse === 'string') return toolResponse.trim().length > 0;
  if (typeof toolResponse !== 'object') return false;
  if (toolResponse.is_error === true) return false;
  if (toolResponse.error) return false;
  if (toolResponse.interrupted === true) return false;
  if (toolResponse.async_launched === true) return false;
  if (toolResponse.ok === false || toolResponse.success === false) return false;
  if (toolResponse.ok === true || toolResponse.success === true) return true;
  const negative = new Set(['error', 'failed', 'cancelled', 'canceled', 'interrupted', 'async_launched', 'running', 'in_progress', 'pending']);
  if (typeof toolResponse.status === 'string' && negative.has(toolResponse.status.toLowerCase())) return false;
  const positive = new Set(['ok', 'done', 'success', 'succeeded', 'complete', 'completed']);
  if (typeof toolResponse.status === 'string') return positive.has(toolResponse.status.toLowerCase());
  for (const field of ['text', 'content', 'message', 'summary']) {
    if (typeof toolResponse[field] === 'string' && toolResponse[field].trim()) return true;
    if (Array.isArray(toolResponse[field]) && toolResponse[field].length > 0) return true;
  }
  return false;
}

function rawAgentNameFromInput(input) {
  const args = (input && (input.args || input.tool_input)) || {};
  return args.agentName || args.agent || args.name || '';
}

function extractToolResult(input, output = {}) {
  if (output && Object.prototype.hasOwnProperty.call(output, 'result')) return output.result;
  if (output && Object.prototype.hasOwnProperty.call(output, 'response')) return output.response;
  if (output && Object.prototype.hasOwnProperty.call(output, 'output')) return output.output;
  if (input && Object.prototype.hasOwnProperty.call(input, 'result')) return input.result;
  if (input && Object.prototype.hasOwnProperty.call(input, 'tool_response')) return input.tool_response;
  if (input && Object.prototype.hasOwnProperty.call(input, 'response')) return input.response;
  if (input && Object.prototype.hasOwnProperty.call(input, 'output')) return input.output;
  return null;
}

function resolveAuthoritativeStatePath(projectDir) {
  let discovery;
  try { discovery = discoverStatePath(projectDir); } catch { return null; }
  if (!discovery || !discovery.authoritative || !discovery.statePath) return null;
  return discovery.statePath;
}

function incrementCounter(state, field) {
  const current = Number.isFinite(state[field]) ? state[field] : 0;
  state[field] = current + 1;
}

function appendStep(state, step) {
  if (!step) return false;
  if (!Array.isArray(state.step_ledger)) state.step_ledger = [];
  if (state.step_ledger.includes(step)) return false;
  state.step_ledger.push(step);
  return true;
}

function stampStateForAgent(state, agentLeaf, nowIso) {
  let changed = false;
  if (agentLeaf === 'checkpoint-validator') {
    incrementCounter(state, 'batch_checkpoints_done');
    changed = true;
  }
  if (agentLeaf === 'review-orchestrator') {
    incrementCounter(state, 'batch_reviews_done');
    changed = true;
  }
  if (agentLeaf === 'executor-fix') {
    incrementCounter(state, 'fix_loop_attempts');
    changed = true;
  }

  const step = ledger.stepForAgent(workflowKeyFromState(state), agentLeaf);
  if (appendStep(state, step)) changed = true;
  if (changed) state.updatedAt = nowIso || new Date().toISOString();
  return { changed, step };
}

function markOnce(target) {
  if (!target || typeof target !== 'object') return true;
  if (target[AFTER_HOOK_MARKER]) return false;
  Object.defineProperty(target, AFTER_HOOK_MARKER, { value: true, enumerable: false, configurable: false });
  return true;
}

function handleToolExecuteAfter(input, output = {}, options = {}) {
  const result = { stamped: false };
  try {
    if (!markOnce(input || output)) return result;
    const toolName = String(input && (input.tool || input.toolName || input.tool_name) || '').trim().toLowerCase();
    if (toolName !== 'task') return result;
    if (output && output.error) return result;
    if (input && input.error) return result;
    const toolResult = extractToolResult(input, output);
    const projectDir = projectDirFromInput(input, options);
    if (!projectDir) return result;
    const statePath = resolveAuthoritativeStatePath(projectDir);
    if (!statePath) return result;
    const { state, verification } = readVerifiedState(statePath);
    if (!verification || verification.valid !== true) return result;
    if (!state || state.pipeline_active !== true) return result;

    const agentLeaf = canonicalAgentLeaf(rawAgentNameFromInput(input));
    if (!agentLeaf) return result;
    if (agentLeaf !== 'executor-fix' && !hasUsableResult(toolResult)) return result;
    const stamped = stampStateForAgent(state, agentLeaf, options.nowIso);
    if (!stamped.changed) return result;
    writeSignedState(statePath, state);
    return { stamped: !!stamped.step, changed: true, step: stamped.step, agentLeaf };
  } catch (err) {
    if (typeof options.audit === 'function') options.audit({ type: 'step-ledger.stamp.error', error: err && err.name ? err.name : 'Error' });
    return result;
  }
}

function createStepLedgerStampHooks(options = {}) {
  return {
    'tool.execute.after': (input, output = {}) => handleToolExecuteAfter(input, output, options),
  };
}

module.exports = {
  AFTER_HOOK_MARKER,
  OPENCODE_AGENT_LEAF_MAP,
  workflowKeyFromState,
  hasUsableResult,
  rawAgentNameFromInput,
  extractToolResult,
  resolveAuthoritativeStatePath,
  incrementCounter,
  appendStep,
  stampStateForAgent,
  handleToolExecuteAfter,
  createStepLedgerStampHooks,
};
