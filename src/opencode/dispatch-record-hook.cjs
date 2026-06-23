'use strict';

const fs = require('node:fs');
const path = require('node:path');

const lock = require('../lib/exclusive-lock.cjs');
const signer = require('../lib/sentinel-state-signer.cjs');
const {
  CORRUPT_SENTINEL,
  discoverStatePath,
} = require('../state/sentinel-state-inspector.cjs');
const {
  canonicalAgentLeaf,
  projectDirFromInput,
  rawAgentNameFromInput,
} = require('./step-ledger-gate.cjs');

const BEFORE_HOOK_MARKER = Symbol.for('pipeline-orchestrator.dispatch-record.tool.execute.before.processed');
let fallbackDispatchCounter = 0;

function normalizeToolName(toolName) {
  return String(toolName || '').trim().toLowerCase();
}

function isAgentTool(input) {
  const toolName = normalizeToolName(input && (input.tool || input.toolName || input.tool_name));
  return toolName === 'task' || toolName === 'agent';
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function argsFromInput(input, output = {}) {
  const inputArgs = objectOrEmpty(input && (input.args || input.tool_input));
  const topLevel = {};
  for (const key of ['agentName', 'agent', 'name', 'subagent_type', 'description', 'prompt']) {
    if (input && typeof input[key] === 'string') topLevel[key] = input[key];
  }
  return { ...topLevel, ...inputArgs, ...objectOrEmpty(output.args) };
}

function fallbackDispatchId(nowIso) {
  fallbackDispatchCounter += 1;
  const parsed = Date.parse(nowIso);
  const stamp = Number.isFinite(parsed) ? parsed : Date.now();
  return `unknown-${stamp}-${fallbackDispatchCounter}`;
}

function dispatchIdFrom(input, output, args, nowIso) {
  for (const value of [
    input && input.tool_use_id,
    input && input.toolUseId,
    input && input.toolCallId,
    input && input.callId,
    input && input.id,
    output && output.tool_use_id,
    output && output.toolUseId,
    output && output.toolCallId,
    args && args.dispatch_id,
  ]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return fallbackDispatchId(nowIso);
}

function runIdFromState(state) {
  return (state && typeof state.runId === 'string' && state.runId)
    || (state && typeof state.run_id === 'string' && state.run_id)
    || '';
}

function phaseFromState(state) {
  return (state && typeof state.currentPhase === 'string' && state.currentPhase)
    || (state && typeof state.current_phase === 'string' && state.current_phase)
    || (state && typeof state.phase === 'string' && state.phase)
    || 'unknown';
}

function stepFromState(state, agentLeaf) {
  return (state && typeof state.currentStep === 'string' && state.currentStep)
    || (state && typeof state.current_step === 'string' && state.current_step)
    || (state && typeof state.step === 'string' && state.step)
    || agentLeaf
    || 'dispatch';
}

function evidenceFromState(state) {
  return (state && typeof state.evidenceSummary === 'string' && state.evidenceSummary)
    || (state && typeof state.evidence_summary === 'string' && state.evidence_summary)
    || 'governed-dispatch';
}

function sanitizeHeaderValue(value) {
  const sanitized = String(value == null ? '' : value).replace(/[^A-Za-z0-9._:-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 256);
  return sanitized || 'unknown';
}

function buildEnvelopedPrompt(originalPrompt, fields) {
  const lines = String(originalPrompt).split(/\r?\n/);
  if (lines.length > 0 && /^\[PIPELINE run=/.test(lines[0])) lines.shift();
  const header = `[PIPELINE run=${sanitizeHeaderValue(fields.runId)} dispatch=${sanitizeHeaderValue(fields.dispatchId)} phase=${sanitizeHeaderValue(fields.phase)} step=${sanitizeHeaderValue(fields.step)} evidence=${sanitizeHeaderValue(fields.evidence)}]`;
  return `${header}\n${lines.join('\n')}`;
}

function containedIn(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function containedInProjectPipeline(projectDir, statePath) {
  if (!projectDir || !statePath) return false;
  try {
    const read = fs.realpathSync.native || fs.realpathSync;
    const pipelineRoot = read(path.join(projectDir, '.pipeline'));
    const resolvedState = read(statePath);
    return containedIn(pipelineRoot, resolvedState);
  } catch (_) {
    return false;
  }
}

function loadActiveStateFromPath(statePath) {
  if (!statePath) return null;
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const verification = signer.verifyState(state);
    return verification.valid ? state : CORRUPT_SENTINEL;
  } catch (_) {
    return CORRUPT_SENTINEL;
  }
}

function statePathForProject(projectDir, options = {}) {
  const discover = options.discoverStatePath || discoverStatePath;
  try {
    const discovered = discover(projectDir);
    const statePath = discovered && discovered.statePath ? discovered.statePath : null;
    if (!statePath) return null;
    return containedInProjectPipeline(projectDir, statePath) ? statePath : null;
  } catch (_) {
    return null;
  }
}

function buildRecord({ dispatchId, state, args, agentLeaf, nowIso }) {
  const rawAgent = rawAgentNameFromArgs(args) || agentLeaf || null;
  return {
    dispatch_id: dispatchId,
    run_id: runIdFromState(state),
    subagent_type: rawAgent,
    target_agent_type: rawAgent,
    agent_type: rawAgent,
    status: 'pending',
    correction_attempts: 0,
    created_at: nowIso,
  };
}

function rawAgentNameFromArgs(args) {
  for (const candidate of [args.agentName, args.agent, args.name, args.subagent_type]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return '';
}

function writeDispatchRecord(statePath, dispatchId, record) {
  if (!statePath) return false;
  const doWrite = () => {
    let state;
    try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (_) { return false; }
    if (!state || typeof state !== 'object' || Array.isArray(state)) return false;
    try {
      const verification = signer.verifyState(state);
      if (!verification.valid && !verification.unsigned && !verification.key_unavailable) return false;
    } catch (_) {
      return false;
    }
    if (!state.pending_dispatches || typeof state.pending_dispatches !== 'object' || Array.isArray(state.pending_dispatches)) {
      state.pending_dispatches = {};
    }
    state.pending_dispatches[dispatchId] = record;
    state.state_version = Number.isFinite(state.state_version) ? state.state_version + 1 : 1;
    state.updatedAt = record.created_at;
    signer.writeSignedState(statePath, state);
    return true;
  };
  try { return lock.withLock(statePath, doWrite); } catch (_) { return false; }
}

function decideDispatchRecord(ctx) {
  if (!ctx || typeof ctx !== 'object') return { decision: 'allow' };
  if (!isAgentTool(ctx.input)) return { decision: 'allow' };
  if (!ctx.projectDir) return { decision: 'allow' };

  const state = ctx.state;
  if (!state) return { decision: 'allow' };
  if (state === CORRUPT_SENTINEL) {
    if (String(process.env.PIPELINE_DISPATCH_RECORD_ENFORCEMENT || 'deny').toLowerCase() === 'warn') return { decision: 'allow', warn: true };
    return { decision: 'block', code: 'DISPATCH_RECORD_STATE_CORRUPT', reason: 'DISPATCH_RECORD_STATE_CORRUPT: sentinel-state is unreadable, so the dispatch cannot be recorded safely.' };
  }
  if (state.pipeline_active !== true) return { decision: 'allow' };

  const args = argsFromInput(ctx.input, ctx.output);
  const agentLeaf = canonicalAgentLeaf(rawAgentNameFromArgs(args) || rawAgentNameFromInput(ctx.input));
  const nowIso = ctx.nowIso || new Date().toISOString();
  const dispatchId = dispatchIdFrom(ctx.input, ctx.output, args, nowIso);
  const record = buildRecord({ dispatchId, state, args, agentLeaf, nowIso });
  const prompt = typeof args.prompt === 'string' ? args.prompt : null;
  return {
    decision: 'allow',
    dispatchId,
    statePath: ctx.statePath,
    record,
    updatedArgs: prompt == null ? null : {
      ...args,
      prompt: buildEnvelopedPrompt(prompt, {
        runId: runIdFromState(state),
        dispatchId,
        phase: phaseFromState(state),
        step: stepFromState(state, agentLeaf),
        evidence: evidenceFromState(state),
      }),
    },
  };
}

function markOnce(target) {
  if (!target || typeof target !== 'object') return true;
  if (target[BEFORE_HOOK_MARKER]) return false;
  Object.defineProperty(target, BEFORE_HOOK_MARKER, { value: true, enumerable: false, configurable: false });
  return true;
}

function gatherContext(input, output, options = {}) {
  const projectDir = projectDirFromInput(input, options);
  const statePath = projectDir ? statePathForProject(projectDir, options) : null;
  return {
    input,
    output,
    projectDir,
    statePath,
    state: statePath ? loadActiveStateFromPath(statePath) : null,
    nowIso: options.nowIso,
  };
}

function handleToolExecuteBefore(input, output = {}, options = {}) {
  if (!markOnce(output)) return output;
  if (output.error) return output;
  const result = decideDispatchRecord(gatherContext(input, output, options));
  if (result.decision === 'block') {
    output.error = { code: result.code || 'DISPATCH_RECORD_BLOCKED', reason: result.reason };
  } else if (result.warn) {
    output.warning = { code: 'DISPATCH_RECORD_WARNING' };
  } else if (result.record) {
    const writer = options.writeDispatchRecord || writeDispatchRecord;
    const written = writer(result.statePath, result.dispatchId, result.record);
    if (!written) {
      output.error = {
        code: 'DISPATCH_RECORD_WRITE_FAILED',
        reason: 'DISPATCH_RECORD_WRITE_FAILED: dispatch was not recorded, so the subagent prompt was not released.',
      };
    } else if (result.updatedArgs) {
      output.args = result.updatedArgs;
    }
  }
  if (typeof options.audit === 'function') options.audit({ type: `dispatch-record.${result.decision}`, result: { decision: result.decision, dispatchId: result.dispatchId } });
  return output;
}

function createDispatchRecordHooks(options = {}) {
  return {
    'tool.execute.before': (input, output = {}) => handleToolExecuteBefore(input, output, options),
  };
}

module.exports = {
  BEFORE_HOOK_MARKER,
  normalizeToolName,
  isAgentTool,
  argsFromInput,
  dispatchIdFrom,
  containedInProjectPipeline,
  loadActiveStateFromPath,
  runIdFromState,
  phaseFromState,
  stepFromState,
  evidenceFromState,
  buildEnvelopedPrompt,
  buildRecord,
  writeDispatchRecord,
  gatherContext,
  decideDispatchRecord,
  handleToolExecuteBefore,
  createDispatchRecordHooks,
};
