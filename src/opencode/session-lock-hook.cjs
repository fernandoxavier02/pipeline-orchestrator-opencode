'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { extractPrompt, resolveProjectDir } = require('./pipeline-arm-writer.cjs');

let classifier = null;
try { classifier = require('../lib/pipeline-workflow-classifier.cjs'); } catch (_) { classifier = null; }

const PROMPT_APPEND_EVENT = 'tui.prompt.append';
const SESSION_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const STALE_HEARTBEAT_THRESHOLD_MS = 10 * 60 * 1000;
const STALE_THRESHOLD_MS = STALE_HEARTBEAT_THRESHOLD_MS;

function detectPipelineInvocation(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  if (classifier && typeof classifier.isPipelineInvocation === 'function') return classifier.isPipelineInvocation(text);
  return /^\/(pipeline|feature-light|feature-heavy|bugfix-light|bugfix-heavy|audit-light|audit-heavy|ux-light|ux-heavy|spec-light|spec-heavy)\b/i.test(text.trim())
    || /^\/pipeline-orchestrator:(pipeline|bugfix|feature|userstory|audit|ux|spec)\b/i.test(text.trim());
}

function isValidSessionId(id) {
  return typeof id === 'string' && SESSION_ID_REGEX.test(id);
}

function nowMs(options = {}) {
  return Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
}

function realpath(value) {
  const read = fs.realpathSync.native || fs.realpathSync;
  return read(value);
}

function resolveExistingPrefix(filePath) {
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

function containedIn(parent, child) {
  const relative = path.relative(resolveExistingPrefix(parent), resolveExistingPrefix(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function safePipelineDir(projectDir) {
  if (typeof projectDir !== 'string' || !projectDir) return null;
  const root = resolveExistingPrefix(projectDir);
  const pipelineDir = path.join(projectDir, '.pipeline');
  if (fs.existsSync(pipelineDir)) {
    try {
      if (fs.lstatSync(pipelineDir).isSymbolicLink()) return null;
      const resolvedPipeline = realpath(pipelineDir);
      return containedIn(root, resolvedPipeline) ? resolvedPipeline : null;
    } catch (_) {
      return null;
    }
  }
  return containedIn(root, pipelineDir) ? path.resolve(pipelineDir) : null;
}

function safeSessionsDir(projectDir, { create = false } = {}) {
  const pipelineDir = safePipelineDir(projectDir);
  if (!pipelineDir) return null;
  if (create) fs.mkdirSync(pipelineDir, { recursive: true });
  const sessionsDir = path.join(pipelineDir, 'sessions');
  if (create) fs.mkdirSync(sessionsDir, { recursive: true });
  try {
    if (fs.existsSync(sessionsDir) && fs.lstatSync(sessionsDir).isSymbolicLink()) return null;
    return containedIn(pipelineDir, sessionsDir) ? sessionsDir : null;
  } catch (_) {
    return null;
  }
}

function writeLockAtomically(filePath, lock) {
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(lock, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
    throw error;
  }
}

function createLock(projectDir, sessionId, options = {}) {
  if (!isValidSessionId(sessionId)) throw new Error('invalid session_id');
  const sessionsDir = safeSessionsDir(projectDir, { create: true });
  if (!sessionsDir) throw new Error('unsafe sessions dir');
  const now = nowMs(options);
  const ttlHours = Number.isFinite(options.ttlHours) ? options.ttlHours : 2;
  const lock = {
    session_id: sessionId,
    created_at: now,
    last_seen_at: now,
    expires_at: now + ttlHours * 3600 * 1000,
    status: 'active',
  };
  writeLockAtomically(path.join(sessionsDir, `${sessionId}.lock`), lock);
  return lock;
}

function refreshHeartbeatAndGC(projectDir, currentSessionId, options = {}) {
  const sessionsDir = safeSessionsDir(projectDir);
  if (!sessionsDir) return { refreshed: 0, stale_marked: 0 };
  if (!fs.existsSync(sessionsDir)) return { refreshed: 0, stale_marked: 0 };
  let entries;
  try { entries = fs.readdirSync(sessionsDir); } catch (_) { return { refreshed: 0, stale_marked: 0 }; }
  const now = nowMs(options);
  let refreshed = 0;
  let staleMarked = 0;
  for (const entry of entries) {
    if (!entry.endsWith('.lock')) continue;
    const filePath = path.join(sessionsDir, entry);
    let lock;
    try { lock = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { continue; }
    if (!lock || lock.status !== 'active' || !isValidSessionId(lock.session_id)) continue;
    if (lock.session_id === currentSessionId) {
      lock.last_seen_at = now;
      try { writeLockAtomically(filePath, lock); refreshed += 1; } catch (_) { /* skip */ }
      continue;
    }
    if (typeof lock.last_seen_at !== 'number') continue;
    if (now - lock.last_seen_at > STALE_HEARTBEAT_THRESHOLD_MS) {
      lock.status = 'completed';
      lock.completed_at = now;
      lock.completed_reason = 'stale_heartbeat';
      try { writeLockAtomically(filePath, lock); staleMarked += 1; } catch (_) { /* skip */ }
    }
  }
  return { refreshed, stale_marked: staleMarked };
}

function sessionIdFromInput(input) {
  if (!input || typeof input !== 'object') return '';
  const args = input.args && typeof input.args === 'object' ? input.args : {};
  const props = input.properties && typeof input.properties === 'object' ? input.properties : {};
  return input.session_id || input.sessionId || args.session_id || args.sessionId || props.session_id || props.sessionId || '';
}

function handlePromptAppend(input = {}, output = {}, options = {}) {
  const projectDir = resolveProjectDir(input, options);
  const sessionId = sessionIdFromInput(input);
  if (!projectDir || !isValidSessionId(sessionId)) return output;
  try { refreshHeartbeatAndGC(projectDir, sessionId, options); } catch (_) { /* fail-open prompt submit */ }
  const prompt = extractPrompt(input);
  if (!detectPipelineInvocation(prompt)) return output;
  try { createLock(projectDir, sessionId, options); } catch (_) { /* fail-open prompt submit */ }
  return output;
}

function handleEvent(input = {}, output = {}, options = {}) {
  const event = input && input.event;
  if (!event || event.type !== PROMPT_APPEND_EVENT) return output;
  return handlePromptAppend({
    ...(event.properties || event),
    cwd: input.cwd,
    directory: input.directory,
    project: input.project,
  }, output, options);
}

function createSessionLockHooks(options = {}) {
  return {
    [PROMPT_APPEND_EVENT]: (input, output = {}) => handlePromptAppend(input, output, options),
    event: (input, output = {}) => handleEvent(input, output, options),
  };
}

module.exports = {
  PROMPT_APPEND_EVENT,
  SESSION_ID_REGEX,
  STALE_HEARTBEAT_THRESHOLD_MS,
  STALE_THRESHOLD_MS,
  detectPipelineInvocation,
  isValidSessionId,
  nowMs,
  writeLockAtomically,
  realpath,
  resolveExistingPrefix,
  containedIn,
  safePipelineDir,
  safeSessionsDir,
  createLock,
  refreshHeartbeatAndGC,
  sessionIdFromInput,
  handlePromptAppend,
  handleEvent,
  createSessionLockHooks,
};
