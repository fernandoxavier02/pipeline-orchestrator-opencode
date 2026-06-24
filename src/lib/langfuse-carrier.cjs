'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SPAN_PREFIX = 'langfuse-span-';
const TRACE_PREFIX = 'langfuse-trace-';
const SESSION_ID_KEY_RE = /^[A-Za-z0-9._-]{1,64}$/;
const emittedAudits = new Set();

function emitAuditOnce(name, fields, key) {
  if (key && emittedAudits.has(key)) return;
  if (key) emittedAudits.add(key);
  try { process.stderr.write(`${JSON.stringify({ audit_event: name, ts: new Date().toISOString(), ...fields })}\n`); } catch (_) { /* no-op */ }
}

function resolveSessionKey() {
  const raw = String(process.env.CLAUDE_SESSION_ID || '').trim();
  return raw && SESSION_ID_KEY_RE.test(raw) ? raw : null;
}

function resolveKey(runId, ppidFallback, kind) {
  if (runId) return String(runId);
  const sessionKey = resolveSessionKey();
  if (sessionKey) {
    emitAuditOnce('CARRIER_SESSION_FALLBACK', { kind, session: sessionKey }, `session:${kind}:${sessionKey}`);
    return `sess-${sessionKey}`;
  }
  const docPath = String(process.env.PIPELINE_DOC_PATH || '').trim();
  if (docPath) {
    const hash = crypto.createHash('sha256').update(docPath.replace(/[\\/]+$/, '')).digest('hex').slice(0, 12);
    emitAuditOnce('CARRIER_DOCPATH_FALLBACK', { kind, doc_hash: hash }, `doc:${kind}:${hash}`);
    return `doc-${hash}`;
  }
  const fallback = ppidFallback || process.ppid || process.pid;
  emitAuditOnce('CARRIER_PPID_FALLBACK', { kind, ppid: fallback }, `ppid:${kind}:${fallback}`);
  return String(fallback);
}

function getSpanPath(runId, ppidFallback) {
  return path.join(os.tmpdir(), `${SPAN_PREFIX}${resolveKey(runId, ppidFallback, 'span')}.json`);
}

function getTracePath(runId, ppidFallback) {
  return path.join(os.tmpdir(), `${TRACE_PREFIX}${resolveKey(runId, ppidFallback, 'trace')}.json`);
}

function writeAtomic(targetPath, data) {
  const dir = path.dirname(targetPath);
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('UNSAFE_CARRIER_DIR');
  fs.writeFileSync(targetPath, data, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
}

function readTraceCarrier(runId, ppidFallback) {
  try {
    const tracePath = getTracePath(runId, ppidFallback);
    if (!fs.existsSync(tracePath)) return null;
    const stat = fs.lstatSync(tracePath);
    if (stat.isSymbolicLink() || stat.nlink > 1) return null;
    const body = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
    return body && typeof body.traceId === 'string' ? body : null;
  } catch (_) {
    return null;
  }
}

function writeTraceCarrier(runId, ppidFallback, data) {
  try {
    const tracePath = getTracePath(runId, ppidFallback);
    if (fs.existsSync(tracePath)) return false;
    writeAtomic(tracePath, JSON.stringify(data));
    return true;
  } catch (_) {
    return false;
  }
}

function cleanupTracePath(runId, ppidFallback) {
  try {
    const tracePath = getTracePath(runId, ppidFallback);
    if (fs.existsSync(tracePath)) fs.unlinkSync(tracePath);
  } catch (_) { /* no-op */ }
}

function cleanupSpanPath(runId, ppidFallback) {
  try {
    const spanPath = getSpanPath(runId, ppidFallback);
    if (fs.existsSync(spanPath)) fs.unlinkSync(spanPath);
  } catch (_) { /* no-op */ }
}

function resolvePpid() {
  const isTest = process.env.PIPELINE_TEST === 'true' || process.env.NODE_ENV === 'test';
  if (isTest) {
    const forced = Number.parseInt(process.env.LANGFUSE_FORCE_PPID || '', 10);
    if (Number.isFinite(forced) && forced > 0) return forced;
  }
  return process.ppid || process.pid;
}

function readTraceCarrierForCurrentProcess() {
  if (process.env.PIPELINE_RUN_ID) {
    const byRun = readTraceCarrier(process.env.PIPELINE_RUN_ID, null);
    if (byRun) return byRun;
  }
  if (resolveSessionKey() || process.env.PIPELINE_DOC_PATH) {
    const byFallback = readTraceCarrier(null, null);
    if (byFallback) return byFallback;
  }
  for (const pid of [process.pid, process.ppid].filter((value) => Number.isFinite(value) && value > 0)) {
    const body = readTraceCarrier(null, pid);
    if (body) return body;
  }
  return null;
}

module.exports = {
  SPAN_PREFIX,
  TRACE_PREFIX,
  getSpanPath,
  getTracePath,
  writeAtomic,
  readTraceCarrier,
  writeTraceCarrier,
  cleanupTracePath,
  cleanupSpanPath,
  resolvePpid,
  readTraceCarrierForCurrentProcess,
  _resolveKey: resolveKey,
};
