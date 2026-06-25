'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { withLock } = require('./exclusive-lock.cjs');
const { ALLOWED_GATE_DECISION_KEYS } = require('./contracts/gate-decision.cjs');

const DETAIL_MAX_LEN = 200;
const ALLOWED_PROTOCOL_EVENT_KEYS = Object.freeze([
  'event_id', 'protocol_event_id', 'event', 'phase', 'dispatch_id', 'gate_id', 'plan_id',
  'target_kind', 'target_name', 'timestamp', 'decided_by', 'detail',
  'result', 'findings_count', 'severity_summary', 'violation_type',
  'response', 'would_approve',
]);

function sanitizeDetail(value) {
  if (value == null) return null;
  let s = String(value).replace(/[\t\n\r]/g, ' ').replace(/[\x00-\x1F\x7F]/g, '');
  s = s.replace(/  +/g, ' ').trim();
  return s.length > DETAIL_MAX_LEN ? `${s.slice(0, DETAIL_MAX_LEN - 3)}...` : s;
}

function validateKeys(entry, allowedKeys) {
  const unknownKeys = [];
  for (const key of Object.keys(entry || {})) {
    if (!allowedKeys.includes(key)) unknownKeys.push(key);
  }
  return { ok: unknownKeys.length === 0, unknownKeys };
}

function sanitizeEntry(entry, kind = 'gate') {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new TypeError('sanitizeEntry: entry must be a plain object');
  }
  const allowed = kind === 'protocol' ? ALLOWED_PROTOCOL_EVENT_KEYS : ALLOWED_GATE_DECISION_KEYS;
  const sanitized = {};
  for (const key of Object.keys(entry)) {
    if (!allowed.includes(key)) continue;
    sanitized[key] = key === 'detail' ? sanitizeDetail(entry[key]) : entry[key];
  }
  return sanitized;
}

function safeAppendJsonl(filePath, entry, opts = {}) {
  const kind = opts.kind || 'gate';
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw new TypeError('safeAppendJsonl: filePath must be absolute');
  }
  const allowed = kind === 'protocol' ? ALLOWED_PROTOCOL_EVENT_KEYS : ALLOWED_GATE_DECISION_KEYS;
  const { unknownKeys } = validateKeys(entry, allowed);
  const sanitized = sanitizeEntry(entry, kind);
  const line = JSON.stringify(sanitized);
  const parsed = JSON.parse(line);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  withLock(filePath, () => {
    fs.appendFileSync(filePath, `${line}\n`, 'utf8');
  });
  return { ok: true, line, parsed, unknownKeysDropped: unknownKeys };
}

module.exports = {
  ALLOWED_GATE_DECISION_KEYS,
  ALLOWED_PROTOCOL_EVENT_KEYS,
  DETAIL_MAX_LEN,
  safeAppendJsonl,
  sanitizeDetail,
  sanitizeEntry,
  validateKeys,
};
