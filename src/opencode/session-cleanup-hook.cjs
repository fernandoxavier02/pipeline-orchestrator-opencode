'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  CORRUPT_SENTINEL,
  findActiveSentinelState,
} = require('../state/sentinel-state-inspector.cjs');
const { projectDirFromInput } = require('./step-ledger-gate.cjs');

const CLEANUP_HOOK_MARKER = Symbol.for('pipeline-orchestrator.session-cleanup.session.idle.processed');
const SESSION_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const TERMINAL_STATES = new Set(['completed', 'hard_failed', 'aborted_by_user', 'cancelled']);

function normalizeEventName(input) {
  const rawEvent = input && input.event;
  const eventName = (rawEvent && typeof rawEvent === 'object' ? rawEvent.type : rawEvent)
    || (input && (input.eventName || input.hook || input.hookName));
  return String(eventName || '').trim().toLowerCase();
}

function isSessionIdle(input) {
  return normalizeEventName(input) === 'session.idle';
}

function sessionIdFromInput(input) {
  const candidate = input && (input.session_id || input.sessionId || input.session && input.session.id);
  return typeof candidate === 'string' && SESSION_ID_RE.test(candidate) ? candidate : null;
}

function isTerminalState(value) {
  return typeof value === 'string' && TERMINAL_STATES.has(value);
}

function resolveForContainment(filePath) {
  const resolved = path.resolve(filePath);
  const missingParts = [];
  let current = resolved;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return resolved;
    missingParts.unshift(path.basename(current));
    current = parent;
  }
  try {
    const real = fs.realpathSync.native || fs.realpathSync;
    const base = real(current);
    return missingParts.length > 0 ? path.join(base, ...missingParts) : base;
  } catch (_) {
    return resolved;
  }
}

function containedIn(parent, child) {
  try {
    if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) return false;
    const relative = path.relative(resolveForContainment(parent), resolveForContainment(child));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  } catch (_) {
    return false;
  }
}

function cleanupAllowed(projectDir, options = {}) {
  const reader = options.findActiveSentinelState || findActiveSentinelState;
  let state = null;
  try { state = reader(projectDir); } catch (_) { state = null; }
  if (!state) return true;
  if (state === CORRUPT_SENTINEL) return false;
  if (isTerminalState(state.terminal_state) || isTerminalState(state.status)) return true;
  if (state.pipeline_active === true) return false;
  return true;
}

function safeSessionsDir(projectDir) {
  const sessionsDir = path.join(projectDir, '.pipeline', 'sessions');
  try {
    if (!fs.existsSync(sessionsDir)) return null;
    if (!containedIn(path.join(projectDir, '.pipeline'), sessionsDir)) return null;
    if (!fs.statSync(sessionsDir).isDirectory()) return null;
    return sessionsDir;
  } catch (_) {
    return null;
  }
}

function readJsonSafe(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
}

function tmpSuffix(options = {}) {
  if (typeof options.tmpSuffix === 'function') return options.tmpSuffix();
  return `${process.pid}.${crypto.randomBytes(8).toString('hex')}`;
}

function atomicWriteJson(filePath, value, options = {}) {
  const tmpPath = `${filePath}.${tmpSuffix(options)}.tmp`;
  let fd;
  try {
    fd = fs.openSync(tmpPath, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n');
  } finally {
    if (typeof fd === 'number') {
      try { fs.closeSync(fd); } catch (_) { /* ignore close failure */ }
    }
  }
  if (fs.lstatSync(filePath).isSymbolicLink()) {
    try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore cleanup failure */ }
    return false;
  }
  fs.renameSync(tmpPath, filePath);
  return true;
}

function isExpiredLock(payload, nowMs) {
  return payload && typeof payload.expires_at === 'number' && Number.isFinite(payload.expires_at) && payload.expires_at <= nowMs;
}

function cleanupSessionFiles(projectDir, sessionId, options = {}) {
  const sessionsDir = safeSessionsDir(projectDir);
  if (!sessionsDir || !sessionId) return { completedLocks: 0, removedExecWindows: 0 };
  const mayMarkCompleted = cleanupAllowed(projectDir, options);
  const nowMs = options.nowMs || Date.now();
  let completedLocks = 0;
  let removedExpiredLocks = 0;
  let removedExecWindows = 0;
  for (const fileName of fs.readdirSync(sessionsDir)) {
    const filePath = path.join(sessionsDir, fileName);
    try {
      if (!containedIn(sessionsDir, filePath)) continue;
      const stat = fs.lstatSync(filePath);
      if (!stat.isFile()) continue;
      const payload = readJsonSafe(filePath);
      if (!payload || payload.session_id !== sessionId) continue;
      if (fileName.endsWith('.exec-window')) {
        fs.unlinkSync(filePath);
        removedExecWindows += 1;
      } else if (fileName.endsWith('.lock') && isExpiredLock(payload, nowMs)) {
        fs.unlinkSync(filePath);
        removedExpiredLocks += 1;
      } else if (fileName.endsWith('.lock') && mayMarkCompleted && payload.status !== 'completed') {
        payload.status = 'completed';
        payload.completed_at = nowMs;
        if (!atomicWriteJson(filePath, payload, options)) continue;
        completedLocks += 1;
      }
    } catch (_) {
      // Cleanup is best-effort and must not block teardown.
    }
  }
  return { completedLocks, removedExpiredLocks, removedExecWindows };
}

function markOnce(target) {
  if (!target || typeof target !== 'object') return true;
  if (target[CLEANUP_HOOK_MARKER]) return false;
  Object.defineProperty(target, CLEANUP_HOOK_MARKER, { value: true, enumerable: false, configurable: false });
  return true;
}

function handleSessionCleanup(input, output = {}, options = {}) {
  if (!markOnce(output)) return output;
  if (!isSessionIdle(input)) return output;
  const projectDir = projectDirFromInput(input, options);
  const sessionId = sessionIdFromInput(input);
  if (!projectDir || !sessionId) return output;
  const result = cleanupSessionFiles(projectDir, sessionId, options);
  if (typeof options.audit === 'function') {
    try { options.audit({ type: 'session-cleanup.observed', session_id: sessionId, ...result }); } catch (_) { /* observer never blocks */ }
  }
  return output;
}

function createSessionCleanupHooks(options = {}) {
  return {
    event: (input, output = {}) => handleSessionCleanup(input, output, options),
    'session.idle': (input, output = {}) => handleSessionCleanup({ ...input, event: 'session.idle' }, output, options),
  };
}

module.exports = {
  CLEANUP_HOOK_MARKER,
  SESSION_ID_RE,
  TERMINAL_STATES,
  normalizeEventName,
  isSessionIdle,
  sessionIdFromInput,
  isTerminalState,
  resolveForContainment,
  containedIn,
  cleanupAllowed,
  safeSessionsDir,
  readJsonSafe,
  tmpSuffix,
  atomicWriteJson,
  isExpiredLock,
  cleanupSessionFiles,
  handleSessionCleanup,
  createSessionCleanupHooks,
};
