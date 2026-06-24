'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { discoverStatePath } = require('../state/sentinel-state-inspector.cjs');
const { projectDirFromInput } = require('./step-ledger-gate.cjs');

const STOP_HOOK_MARKER = Symbol.for('pipeline-orchestrator.stop-hook.session.idle.processed');
const MATERIAL_FIELDS = Object.freeze([
  'type',
  'complexity',
  'variant',
  'total_gates_triggered',
  'total_gates_expected',
  'fidelity_score',
  'final_decision',
  'pipeline_doc_path',
]);

function normalizeEventName(input) {
  const rawEvent = input && input.event;
  const eventName = (rawEvent && typeof rawEvent === 'object' ? rawEvent.type : rawEvent)
    || (input && (input.eventName || input.hook || input.hookName));
  return String(eventName || '').trim().toLowerCase();
}

function isSessionIdle(input) {
  return normalizeEventName(input) === 'session.idle';
}

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeJsonSafe(filePath, value) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
    return true;
  } catch (_) {
    return false;
  }
}

function appendJsonlSafe(filePath, value) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(value).replace(/[\r\n]+/g, ' ')}\n`);
    return true;
  } catch (_) {
    return false;
  }
}

function statePathForProject(projectDir, options = {}) {
  const discover = options.discoverStatePath || discoverStatePath;
  try {
    const discovered = discover(projectDir);
    return discovered && discovered.statePath ? discovered.statePath : null;
  } catch (_) {
    return null;
  }
}

function countJsonlRows(filePath) {
  try {
    if (!fs.existsSync(filePath)) return 0;
    return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter((line) => line.trim()).length;
  } catch (_) {
    return 0;
  }
}

function readJsonlSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  } catch (_) {
    return [];
  }
}

function runIdFromState(state, runDir) {
  return (state && typeof state.runId === 'string' && state.runId)
    || (state && typeof state.run_id === 'string' && state.run_id)
    || path.basename(runDir || '')
    || 'unknown';
}

function relativeRunDir(projectDir, runDir) {
  return path.relative(projectDir, runDir).replace(/\\/g, '/') + '/';
}

function parseStartTime(state, session) {
  return (session && typeof session.started_at === 'string' && session.started_at)
    || (state && typeof state.created_at === 'string' && state.created_at)
    || (state && typeof state.createdAt === 'string' && state.createdAt)
    || null;
}

function durationSeconds(startedAt, endedAt) {
  if (!startedAt || /^\d{4}-\d{2}-\d{2}$/.test(String(startedAt).trim())) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.floor((end - start) / 1000);
}

function finalDecision(state, session) {
  return (session && session.status)
    || (state && state.final_decision)
    || (state && state.terminal_state)
    || (state && state.status)
    || 'UNKNOWN';
}

function buildFidelityReport(runDir, state, options = {}) {
  const gatePath = path.join(runDir, 'gate-decisions.jsonl');
  const triggered = countJsonlRows(gatePath);
  const report = {
    schemaVersion: 'PIPELINE_FIDELITY_REPORT/v1',
    run_id: runIdFromState(state, runDir),
    generated_by: 'opencode-stop-hook',
    generated_at: options.nowIso || new Date().toISOString(),
    mandatory_triggered: triggered,
    mandatory_expected: null,
    fidelity_score: triggered > 0 ? 1 : 0,
  };
  return writeJsonSafe(path.join(runDir, 'fidelity-report.json'), report) ? report : null;
}

function ensureFidelityReport(runDir, state, options = {}) {
  const existing = readJsonSafe(path.join(runDir, 'fidelity-report.json'));
  if (existing) return existing;
  const fresh = buildFidelityReport(runDir, state, options);
  return fresh;
}

function buildRunLogEntry(projectDir, runDir, state, options = {}) {
  const session = readJsonSafe(path.join(runDir, 'session.json')) || {};
  const fidelity = readJsonSafe(path.join(runDir, 'fidelity-report.json')) || {};
  const endedAt = options.nowIso || new Date().toISOString();
  const startedAt = parseStartTime(state, session);
  return {
    run_id: runIdFromState(state, runDir),
    timestamp_start: startedAt,
    timestamp_end: endedAt,
    type: (state && (state.task_type || state.type)) || session.type || null,
    complexity: (state && state.complexity) || session.complexity || null,
    variant: (state && state.variant) || session.variant || null,
    total_gates_triggered: countJsonlRows(path.join(runDir, 'gate-decisions.jsonl')),
    total_gates_expected: Number.isFinite(Number(fidelity.mandatory_expected)) ? Number(fidelity.mandatory_expected) : null,
    fidelity_score: typeof fidelity.fidelity_score === 'number' ? fidelity.fidelity_score : null,
    duration_seconds: durationSeconds(startedAt, endedAt),
    final_decision: finalDecision(state, session),
    pipeline_doc_path: relativeRunDir(projectDir, runDir),
  };
}

function materialEqual(a, b) {
  return a === b || (a == null && b == null);
}

function shouldAppendRunLogEntry(candidate, existingEntries) {
  if (!candidate) return false;
  if (!Array.isArray(existingEntries) || existingEntries.length === 0) return true;
  let prior = null;
  for (let i = existingEntries.length - 1; i >= 0; i -= 1) {
    const entry = existingEntries[i];
    if (entry && entry.run_id === candidate.run_id) { prior = entry; break; }
  }
  if (!prior) return true;
  return MATERIAL_FIELDS.some((field) => !materialEqual(candidate[field], prior[field]));
}

function appendRunLog(projectDir, entry) {
  const runLogPath = path.join(projectDir, '.pipeline', 'run-log.jsonl');
  if (!shouldAppendRunLogEntry(entry, readJsonlSafe(runLogPath))) return { ok: true, skipped: true };
  return { ok: appendJsonlSafe(runLogPath, entry), skipped: false };
}

function markOnce(target) {
  if (!target || typeof target !== 'object') return true;
  if (target[STOP_HOOK_MARKER]) return false;
  Object.defineProperty(target, STOP_HOOK_MARKER, { value: true, enumerable: false, configurable: false });
  return true;
}

function handleStop(input, output = {}, options = {}) {
  if (!markOnce(output)) return output;
  if (!isSessionIdle(input)) return output;
  const projectDir = projectDirFromInput(input, options);
  if (!projectDir) return output;
  const statePath = statePathForProject(projectDir, options);
  if (!statePath) return output;
  const runDir = path.dirname(statePath);
  const state = readJsonSafe(statePath);
  if (!state || typeof state !== 'object') return output;
  try { ensureFidelityReport(runDir, state, options); } catch (_) { /* observer never blocks */ }
  try { appendRunLog(projectDir, buildRunLogEntry(projectDir, runDir, state, options)); } catch (_) { /* observer never blocks */ }
  if (typeof options.audit === 'function') {
    try { options.audit({ type: 'stop-hook.observed', run_id: runIdFromState(state, runDir) }); } catch (_) { /* observer never blocks */ }
  }
  return output;
}

function createStopHookHooks(options = {}) {
  return {
    event: (input, output = {}) => handleStop(input, output, options),
    'session.idle': (input, output = {}) => handleStop({ ...input, event: 'session.idle' }, output, options),
  };
}

module.exports = {
  STOP_HOOK_MARKER,
  MATERIAL_FIELDS,
  normalizeEventName,
  isSessionIdle,
  readJsonSafe,
  writeJsonSafe,
  appendJsonlSafe,
  statePathForProject,
  countJsonlRows,
  readJsonlSafe,
  runIdFromState,
  relativeRunDir,
  parseStartTime,
  durationSeconds,
  finalDecision,
  buildFidelityReport,
  ensureFidelityReport,
  buildRunLogEntry,
  materialEqual,
  shouldAppendRunLogEntry,
  appendRunLog,
  handleStop,
  createStopHookHooks,
};
