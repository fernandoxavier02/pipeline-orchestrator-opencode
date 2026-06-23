'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  CORRUPT_SENTINEL,
  discoverStatePath,
  findActiveSentinelState,
} = require('../state/sentinel-state-inspector.cjs');
const gateLogGuard = require('../lib/gate-log-guard.cjs');
const { redactString } = require('../validators/redactor.cjs');
const { projectDirFromInput } = require('./step-ledger-gate.cjs');

const REPLIED_HOOK_MARKER = Symbol.for('pipeline-orchestrator.human-gate.permission.replied.processed');

function normalizeToolName(toolName) {
  return String(toolName || '').trim().toLowerCase();
}

function isQuestionReply(input) {
  const toolName = normalizeToolName(input && (input.tool || input.toolName || input.tool_name));
  const rawEvent = input && input.event;
  const eventName = normalizeToolName((rawEvent && typeof rawEvent === 'object' ? rawEvent.type : rawEvent) || (input && (input.eventName || input.hook || input.hookName)));
  if (eventName === 'question.replied' || eventName === 'permission.replied') return true;
  return toolName === 'question' || toolName === 'askuserquestion' || toolName === 'ask_user_question';
}

function redactHumanAnswer(value) {
  return redactString(String(value))
    .replace(/"([^"]*(?:TOKEN|SECRET|PASSWORD|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY)[^"]*)"\s*:\s*"[^"]*"/gi, '"$1":"[REDACTED_SECRET]"')
    .replace(/"([^"]*(?:TOKEN|SECRET|PASSWORD|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY)[^"]*)"\s*:\s*(?!")[^,}\]]+/gi, '"$1":"[REDACTED_SECRET]"')
    .replace(/\b([A-Za-z_][A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY))\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED_SECRET]')
    .replace(/\b(xox[baprs]-[A-Za-z0-9-]{10,}|glpat-[A-Za-z0-9_-]{10,}|npm_[A-Za-z0-9_-]{10,})\b/g, '[REDACTED_SECRET]')
    .replace(/\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Authorization: Bearer [REDACTED_SECRET]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, 'Bearer [REDACTED_SECRET]')
    .replace(/\b(sk-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,})\b/g, '[REDACTED_SECRET]')
    .replace(/\b([A-Za-z_][A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY))\s+[^\s,;]+/gi, '$1 [REDACTED_SECRET]');
}

function answerFromInput(input) {
  if (!input || typeof input !== 'object') return undefined;
  const event = input.event;
  if (event && typeof event === 'object' && event.properties && typeof event.properties === 'object') {
    for (const key of ['answers', 'answer', 'reply', 'response']) {
      if (Object.prototype.hasOwnProperty.call(event.properties, key)) return event.properties[key];
    }
  }
  for (const key of ['tool_response', 'answers', 'answer', 'reply', 'response']) {
    if (Object.prototype.hasOwnProperty.call(input, key)) return input[key];
  }
  return undefined;
}

function hasRealAnswer(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasRealAnswer);
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function summarizeAnswer(toolResponse) {
  let text;
  if (toolResponse == null) text = 'no_answer';
  else if (typeof toolResponse === 'string') text = toolResponse;
  else {
    try { text = JSON.stringify(toolResponse); } catch (_) { text = 'unserializable_answer'; }
  }
  return redactHumanAnswer(text).replace(/[\r\n]+/g, ' ').slice(0, 200);
}

function sanitizeIdentifier(value) {
  const redacted = redactHumanAnswer(value == null ? '' : value).replace(/[\r\n]+/g, ' ');
  const sanitized = redacted.replace(/[^A-Za-z0-9._:\[\]-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 128);
  return sanitized || 'unknown';
}

function toolUseIdFromInput(input) {
  const event = input && input.event;
  for (const value of [
    input && input.tool_use_id,
    input && input.toolUseId,
    input && input.toolCallId,
    input && input.callId,
    input && input.id,
    event && event.properties && event.properties.requestID,
    event && event.id,
  ]) {
    if (typeof value === 'string' && value.trim()) return sanitizeIdentifier(value.trim());
  }
  return 'unknown';
}

function loadActiveState(projectDir, options = {}) {
  const reader = options.findActiveSentinelState || findActiveSentinelState;
  try { return reader(projectDir); } catch (_) { return null; }
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
  try {
    if (!samePath(realPath(runDir), runDir)) return null;
  } catch (_) {
    return null;
  }
  const gateFile = path.join(runDir, 'gate-decisions.jsonl');
  try {
    const stat = fs.lstatSync(gateFile);
    if (stat.isSymbolicLink()) return null;
    if (stat.nlink > 1) return null;
  } catch (_) {
    // Missing file is fine; it will be created inside the trusted run dir.
  }
  if (fs.existsSync(gateFile) && !containedIn(runDir, gateFile)) return null;
  return gateFile;
}

function activeRunDir(projectDir, options = {}) {
  const candidates = [];
  try {
    const discovered = discoverStatePath(projectDir);
    if (discovered && discovered.statePath) candidates.push(path.dirname(discovered.statePath));
  } catch (_) {
    // Fall through to candidate validation.
  }
  if (typeof options.runDir === 'function') candidates.push(options.runDir(projectDir));
  if (typeof options.runDir === 'string' && options.runDir) candidates.push(options.runDir);
  for (const candidate of candidates) {
    const trusted = trustedRunDir(projectDir, candidate);
    if (trusted) return trusted;
  }
  return null;
}

function phaseFromState(state) {
  return (state && typeof state.currentPhase === 'string' && state.currentPhase)
    || (state && typeof state.current_phase === 'string' && state.current_phase)
    || (state && typeof state.phase === 'string' && state.phase)
    || 'unknown';
}

function runIdFromState(state) {
  return (state && typeof state.runId === 'string' && state.runId)
    || (state && typeof state.run_id === 'string' && state.run_id)
    || 'unknown';
}

function typeFromState(state) {
  return (state && typeof state.task_type === 'string' && state.task_type)
    || (state && typeof state.workflow_key === 'string' && state.workflow_key)
    || undefined;
}

function complexityFromState(state) {
  return (state && typeof state.complexity === 'string' && state.complexity)
    || (state && state.orchestrator_decision && typeof state.orchestrator_decision.complexity === 'string' && state.orchestrator_decision.complexity)
    || undefined;
}

function buildGateDecision(input, state, nowIso) {
  const record = {
    gate: 'HUMAN_GATE',
    hardness: 'AUDIT',
    phase: phaseFromState(state),
    decision: 'CONFIRMED',
    decided_by: 'user',
    timestamp: nowIso || new Date().toISOString(),
    detail: `tool_use_id=${toolUseIdFromInput(input)} answer=${summarizeAnswer(answerFromInput(input))}`,
    confidence_impact: 0,
    run_id: runIdFromState(state),
    schema_version: '1',
  };
  const type = typeFromState(state);
  const complexity = complexityFromState(state);
  if (type) record.type = type;
  if (complexity) record.complexity = complexity;
  return record;
}

function appendGateDecision(runDir, record) {
  try {
    const gateFile = trustedGateFile(runDir);
    if (!gateFile) return false;
    const line = JSON.stringify(record).replace(/[\r\n]+/g, ' ');
    fs.appendFileSync(gateFile, `${line}\n`);
    return true;
  } catch (_) {
    return false;
  }
}

function decideHumanGateRecord(ctx) {
  if (!ctx || typeof ctx !== 'object') return { decision: 'allow' };
  if (!isQuestionReply(ctx.input)) return { decision: 'allow' };
  if (!hasRealAnswer(answerFromInput(ctx.input))) return { decision: 'allow' };
  if (!ctx.projectDir) return { decision: 'allow' };
  const state = ctx.state;
  if (!state || state === CORRUPT_SENTINEL) return { decision: 'allow' };
  if (state.pipeline_active !== true) return { decision: 'allow' };
  if (!ctx.runDir) return { decision: 'allow' };
  return { decision: 'record', runDir: ctx.runDir, record: buildGateDecision(ctx.input, state, ctx.nowIso) };
}

function markOnce(target) {
  if (!target || typeof target !== 'object') return true;
  if (target[REPLIED_HOOK_MARKER]) return false;
  Object.defineProperty(target, REPLIED_HOOK_MARKER, { value: true, enumerable: false, configurable: false });
  return true;
}

function gatherContext(input, options = {}) {
  const projectDir = projectDirFromInput(input, options);
  const state = projectDir ? loadActiveState(projectDir, options) : null;
  return {
    input,
    projectDir,
    state,
    runDir: projectDir ? activeRunDir(projectDir, options) : null,
    nowIso: options.nowIso,
  };
}

function handlePermissionReplied(input, output = {}, options = {}) {
  if (!markOnce(output)) return output;
  const result = decideHumanGateRecord(gatherContext(input, options));
  let written = false;
  if (result.decision === 'record') {
    const writer = typeof options.appendGateDecision === 'function' ? options.appendGateDecision : appendGateDecision;
    written = writer(result.runDir, result.record) === true;
  }
  if (typeof options.audit === 'function') {
    options.audit({
      type: `human-gate.${result.decision}`,
      decision: result.decision,
      gate: result.record && result.record.gate,
      recorded: written,
    });
  }
  return output;
}

function humanGateCanSatisfyRequiredGates(required = gateLogGuard.REQUIRED_GATES_BEFORE) {
  return Object.values(required || {}).some((gates) => Array.isArray(gates) && gates.includes('HUMAN_GATE'));
}

function createHumanGateRecordHooks(options = {}) {
  return {
    event: (input, output = {}) => handlePermissionReplied(input, output, options),
    'permission.replied': (input, output = {}) => handlePermissionReplied(input, output, options),
    'question.replied': (input, output = {}) => handlePermissionReplied({ ...input, event: 'question.replied' }, output, options),
  };
}

module.exports = {
  REPLIED_HOOK_MARKER,
  normalizeToolName,
  isQuestionReply,
  redactHumanAnswer,
  answerFromInput,
  hasRealAnswer,
  summarizeAnswer,
  sanitizeIdentifier,
  toolUseIdFromInput,
  loadActiveState,
  containedIn,
  samePath,
  realPath,
  trustedRunDir,
  trustedGateFile,
  activeRunDir,
  phaseFromState,
  runIdFromState,
  typeFromState,
  complexityFromState,
  buildGateDecision,
  appendGateDecision,
  decideHumanGateRecord,
  humanGateCanSatisfyRequiredGates,
  gatherContext,
  handlePermissionReplied,
  createHumanGateRecordHooks,
};
