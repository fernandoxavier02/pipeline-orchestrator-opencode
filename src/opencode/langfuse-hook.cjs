'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CORRUPT_SENTINEL,
  findActiveSentinelState,
} = require('../state/sentinel-state-inspector.cjs');
const { redactString } = require('../validators/redactor.cjs');
const {
  projectDirFromInput,
  rawAgentNameFromInput,
} = require('./step-ledger-gate.cjs');
const { sanitizeSpanPayload } = require('../lib/langfuse-sanitizer.cjs');

const BEFORE_HOOK_MARKER = Symbol.for('pipeline-orchestrator.langfuse.tool.execute.before.processed');
const AFTER_HOOK_MARKER = Symbol.for('pipeline-orchestrator.langfuse.tool.execute.after.processed');
const MAX_TEXT = 2000;
const ACTIVE_CARRIERS = new Map();

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

function agentNameFromArgs(args, input) {
  for (const candidate of [args.agentName, args.agent, args.name, args.subagent_type, rawAgentNameFromInput(input)]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  if (typeof args.description === 'string' && args.description.trim()) return args.description.trim().slice(0, 64);
  return 'agent';
}

function isEnabled(env = process.env) {
  const flag = String(env.LANGFUSE_ENABLED || '').trim().toLowerCase();
  return flag === 'true' || flag === '1';
}

function sampleRate(env = process.env) {
  const raw = env.LANGFUSE_SAMPLE_RATE;
  if (raw == null || raw === '') return 1;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return 1;
  return parsed;
}

function shouldSample(rate, random = Math.random) {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  return random() < rate;
}

function truncate(text) {
  const value = String(text == null ? '' : text);
  if (value.length <= MAX_TEXT) return value;
  return `${value.slice(0, MAX_TEXT - 3)}...`;
}

function redactSpanText(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value == null ? '' : value);
  const redacted = redactString(text)
    .replace(/"([^"]*(?:TOKEN|SECRET|PASSWORD|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY)[^"]*)"\s*:\s*"[^"]*"/gi, '"$1":"[REDACTED_SECRET]"')
    .replace(/\b([A-Za-z_][A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY))\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED_SECRET]')
    .replace(/\b(xox[baprs]-[A-Za-z0-9-]{10,}|glpat-[A-Za-z0-9_-]{10,}|npm_[A-Za-z0-9_-]{10,})\b/g, '[REDACTED_SECRET]')
    .replace(/\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Authorization: Bearer [REDACTED_SECRET]')
    .replace(/\b(sk-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,})\b/g, '[REDACTED_SECRET]');
  return truncate(sanitizeSpanPayload(redacted, process.env.OPENCODE_PLUGIN_ROOT || process.env.CLAUDE_PLUGIN_ROOT));
}

function sanitizeMetaValue(value) {
  if (value == null) return null;
  if (typeof value === 'string') return redactSpanText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return redactSpanText(value);
}

function runIdFromState(state) {
  return (state && typeof state.runId === 'string' && state.runId)
    || (state && typeof state.run_id === 'string' && state.run_id)
    || 'unknown';
}

function phaseFromState(state) {
  return (state && typeof state.currentPhase === 'string' && state.currentPhase)
    || (state && typeof state.current_phase === 'string' && state.current_phase)
    || (state && typeof state.phase === 'string' && state.phase)
    || 'unknown';
}

function typeFromState(state) {
  return (state && typeof state.task_type === 'string' && state.task_type)
    || (state && typeof state.workflow_key === 'string' && state.workflow_key)
    || null;
}

function complexityFromState(state) {
  return (state && typeof state.complexity === 'string' && state.complexity)
    || (state && state.orchestrator_decision && typeof state.orchestrator_decision.complexity === 'string' && state.orchestrator_decision.complexity)
    || null;
}

function buildMetadata(state, agentName) {
  return {
    run_id: sanitizeMetaValue(runIdFromState(state)),
    phase: sanitizeMetaValue(phaseFromState(state)),
    type: sanitizeMetaValue(typeFromState(state)),
    complexity: sanitizeMetaValue(complexityFromState(state)),
    agent_name: sanitizeMetaValue(agentName),
  };
}

function hashKey(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
}

function toolUseIdFrom(input, output, args) {
  for (const value of [
    input && input.tool_use_id,
    input && input.toolUseId,
    input && input.toolCallId,
    input && input.callId,
    input && input.id,
    output && output.tool_use_id,
    output && output.toolUseId,
    args && args.dispatch_id,
  ]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return `${agentNameFromArgs(args || {}, input)}-${Date.now()}`;
}

function carrierRoot(options = {}) {
  return typeof options.carrierRoot === 'string' && options.carrierRoot ? options.carrierRoot : os.tmpdir();
}

function spanCarrierPath(runId, toolUseId, options = {}) {
  const key = hashKey(`${runId || 'unknown'}:${toolUseId || 'unknown'}`);
  return path.join(carrierRoot(options), `pipeline-opencode-langfuse-span-${key}.json`);
}

function activeCarrierPath(runId, toolUseId, options = {}) {
  const preferred = spanCarrierPath(runId, toolUseId, options);
  if (ACTIVE_CARRIERS.has(preferred)) return preferred;
  for (const [filePath, expected] of ACTIVE_CARRIERS.entries()) {
    if (expected && expected.carrier && expected.carrier.toolUseId === toolUseId) return filePath;
  }
  return preferred;
}

function ensureSafeCarrierDir(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const stat = fs.lstatSync(dir);
  return stat.isDirectory() && !stat.isSymbolicLink();
}

function writeSpanCarrier(filePath, carrier) {
  try {
    if (!ensureSafeCarrierDir(filePath)) return false;
    const body = JSON.stringify(carrier);
    fs.writeFileSync(filePath, body, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    ACTIVE_CARRIERS.set(filePath, { carrier, bodyHash: hashKey(body) });
    return true;
  } catch (_) {
    return false;
  }
}

function readAndDeleteSpanCarrier(filePath) {
  const expected = ACTIVE_CARRIERS.get(filePath);
  if (!expected) return null;
  try {
    if (!fs.existsSync(filePath)) {
      ACTIVE_CARRIERS.delete(filePath);
      return null;
    }
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || stat.nlink > 1) {
      ACTIVE_CARRIERS.delete(filePath);
      return null;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const carrier = JSON.parse(raw);
    if (!carrier || hashKey(JSON.stringify(carrier)) !== expected.bodyHash) {
      ACTIVE_CARRIERS.delete(filePath);
      return null;
    }
    try { fs.unlinkSync(filePath); } catch (_) { /* best effort */ }
    ACTIVE_CARRIERS.delete(filePath);
    return expected.carrier;
  } catch (_) {
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_err) { /* best effort */ }
    ACTIVE_CARRIERS.delete(filePath);
    return null;
  }
}

function loadActiveState(projectDir, options = {}) {
  const reader = options.findActiveSentinelState || findActiveSentinelState;
  try { return reader(projectDir); } catch (_) { return null; }
}

function resolveClient(options = {}) {
  if (options.client) return options.client;
  if (typeof options.getClient === 'function') {
    try { return options.getClient(); } catch (_) { return null; }
  }
  try { return require('../lib/langfuse-client.cjs').getClient(); } catch (_) { return null; }
}

function hasClientMethods(client) {
  return !!(client && (typeof client.trace === 'function' || typeof client.span === 'function'));
}

function traceNameFor(state) {
  const runId = runIdFromState(state);
  return runId && runId !== 'unknown' ? `pipeline-run:${runId}` : 'pipeline-run';
}

function openSpan(client, carrier, promptText) {
  const input = redactSpanText(promptText || '');
  if (client && typeof client.trace === 'function') {
    const trace = client.trace({ id: carrier.traceId, name: carrier.traceName, metadata: carrier.metadata });
    if (trace && typeof trace.span === 'function') {
      trace.span({
        id: carrier.spanId,
        name: carrier.agentName,
        startTime: carrier.startedAt,
        input,
        metadata: carrier.metadata,
      });
    }
    return true;
  }
  if (client && typeof client.span === 'function') {
    client.span({
      traceId: carrier.traceId,
      id: carrier.spanId,
      name: carrier.agentName,
      startTime: carrier.startedAt,
      input,
      metadata: carrier.metadata,
    });
    return true;
  }
  return false;
}

function duration(startedAt, endedAt) {
  const t0 = Date.parse(startedAt);
  let t1 = Date.parse(endedAt);
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) return { durationMs: 1, endTime: endedAt };
  if (t1 === t0) t1 = t0 + 1;
  return { durationMs: t1 - t0, endTime: new Date(t1).toISOString() };
}

function closeSpan(client, carrier, toolResponse, nowIso) {
  const endedAt = nowIso || new Date().toISOString();
  const computed = duration(carrier.startedAt, endedAt);
  const output = redactSpanText(toolResponse == null ? '' : toolResponse);
  if (client && typeof client.span === 'function') {
    const span = client.span({ traceId: carrier.traceId, id: carrier.spanId, startTime: carrier.startedAt });
    if (span && typeof span.end === 'function') {
      span.end({
        output,
        endTime: computed.endTime,
        metadata: { duration_ms: computed.durationMs, agent_name: carrier.agentName },
      });
    }
    return true;
  }
  if (client && typeof client.trace === 'function') {
    const trace = client.trace({ id: carrier.traceId });
    if (trace && typeof trace.span === 'function') {
      const span = trace.span({ id: carrier.spanId, name: carrier.agentName, startTime: carrier.startedAt, output });
      if (span && typeof span.end === 'function') span.end({ endTime: computed.endTime, metadata: { duration_ms: computed.durationMs } });
      return true;
    }
  }
  return false;
}

function markOnce(target, marker) {
  if (!target || typeof target !== 'object') return true;
  if (target[marker]) return false;
  Object.defineProperty(target, marker, { value: true, enumerable: false, configurable: false });
  return true;
}

function handleToolExecuteBefore(input, output = {}, options = {}) {
  if (!markOnce(output, BEFORE_HOOK_MARKER)) return output;
  if (output.error) return output;
  if (!isEnabled(options.env || process.env)) return output;
  if (!isAgentTool(input)) return output;

  const projectDir = projectDirFromInput(input, options);
  const state = projectDir ? loadActiveState(projectDir, options) : null;
  if (!state || state === CORRUPT_SENTINEL || state.pipeline_active !== true) return output;
  if (!shouldSample(sampleRate(options.env || process.env), options.random || Math.random)) return output;

  const client = resolveClient(options);
  if (!hasClientMethods(client)) return output;

  const args = argsFromInput(input, output);
  const runId = runIdFromState(state);
  const safeRunId = sanitizeMetaValue(runId);
  const toolUseId = toolUseIdFrom(input, output, args);
  const agentName = redactSpanText(agentNameFromArgs(args, input));
  const nowIso = options.nowIso || new Date().toISOString();
  const carrier = {
    traceId: `lf-trace-${hashKey(runId)}`,
    traceName: redactSpanText(traceNameFor(state)),
    spanId: `lf-span-${hashKey(`${runId}:${toolUseId}`)}`,
    runId: safeRunId,
    toolUseId,
    agentName,
    nonce: crypto.randomBytes(16).toString('hex'),
    startedAt: nowIso,
    metadata: buildMetadata(state, agentName),
  };
  if (!writeSpanCarrier(spanCarrierPath(runId, toolUseId, options), carrier)) return output;
  try { openSpan(client, carrier, args.prompt || ''); } catch (_) { /* telemetry never blocks tool execution */ }
  if (typeof options.audit === 'function') {
    try { options.audit({ type: 'langfuse.open', runId: safeRunId, agentName, recorded: true }); } catch (_) { /* telemetry audit never blocks */ }
  }
  return output;
}

function toolResponseFrom(input, output) {
  if (output && Object.prototype.hasOwnProperty.call(output, 'tool_response')) return output.tool_response;
  if (output && Object.prototype.hasOwnProperty.call(output, 'response')) return output.response;
  if (input && Object.prototype.hasOwnProperty.call(input, 'tool_response')) return input.tool_response;
  if (input && Object.prototype.hasOwnProperty.call(input, 'response')) return input.response;
  return null;
}

function handleToolExecuteAfter(input, output = {}, options = {}) {
  if (!markOnce(output, AFTER_HOOK_MARKER)) return output;
  if (!isEnabled(options.env || process.env)) return output;
  if (!isAgentTool(input)) return output;
  const args = argsFromInput(input, output);
  const projectDir = projectDirFromInput(input, options);
  const state = projectDir ? loadActiveState(projectDir, options) : null;
  const runId = state && state !== CORRUPT_SENTINEL ? runIdFromState(state) : 'unknown';
  const toolUseId = toolUseIdFrom(input, output, args);
  const carrier = readAndDeleteSpanCarrier(activeCarrierPath(runId, toolUseId, options));
  if (!carrier) return output;
  const client = resolveClient(options);
  if (!hasClientMethods(client)) return output;
  try { closeSpan(client, carrier, toolResponseFrom(input, output), options.nowIso); } catch (_) { /* telemetry never blocks tool execution */ }
  if (typeof options.audit === 'function') {
    try { options.audit({ type: 'langfuse.close', runId: carrier.runId, agentName: carrier.agentName, recorded: true }); } catch (_) { /* telemetry audit never blocks */ }
  }
  return output;
}

function createLangfuseHooks(options = {}) {
  return {
    'tool.execute.before': (input, output = {}) => handleToolExecuteBefore(input, output, options),
    'tool.execute.after': (input, output = {}) => handleToolExecuteAfter(input, output, options),
  };
}

module.exports = {
  BEFORE_HOOK_MARKER,
  AFTER_HOOK_MARKER,
  MAX_TEXT,
  ACTIVE_CARRIERS,
  normalizeToolName,
  isAgentTool,
  argsFromInput,
  agentNameFromArgs,
  isEnabled,
  sampleRate,
  shouldSample,
  redactSpanText,
  sanitizeMetaValue,
  runIdFromState,
  phaseFromState,
  typeFromState,
  complexityFromState,
  buildMetadata,
  hashKey,
  toolUseIdFrom,
  spanCarrierPath,
  activeCarrierPath,
  writeSpanCarrier,
  readAndDeleteSpanCarrier,
  loadActiveState,
  resolveClient,
  hasClientMethods,
  traceNameFor,
  openSpan,
  duration,
  closeSpan,
  handleToolExecuteBefore,
  handleToolExecuteAfter,
  createLangfuseHooks,
};
