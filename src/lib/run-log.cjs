'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { withLock } = require('./exclusive-lock.cjs');
const { sanitizeDetail } = require('./jsonl-sanitizer.cjs');

const RUN_LOG_REL_DIR = '.pipeline';
const RUN_LOG_FILENAME = 'run-log.jsonl';
const REQUIRED_FIELDS = Object.freeze([
  'run_id', 'timestamp_start', 'timestamp_end', 'type', 'complexity', 'variant',
  'total_gates_triggered', 'total_gates_expected', 'fidelity_score',
  'duration_seconds', 'final_decision', 'pipeline_doc_path',
]);
const TEXT_FIELDS = new Set(['final_decision', 'pipeline_doc_path', 'run_id', 'variant']);
const NUMERIC_FIELDS = new Set(['total_gates_triggered', 'total_gates_expected', 'fidelity_score', 'duration_seconds']);

function runLogPath(repoRoot) {
  return path.join(repoRoot, RUN_LOG_REL_DIR, RUN_LOG_FILENAME);
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError('appendRunLog: entry must be a plain object');
  const out = {};
  for (const field of REQUIRED_FIELDS) {
    let value = entry[field];
    if (TEXT_FIELDS.has(field)) value = sanitizeDetail(value);
    if (field === 'type' || field === 'complexity') value = sanitizeDetail(value);
    if (NUMERIC_FIELDS.has(field)) {
      if (value == null) value = null;
      else {
        const n = Number(value);
        value = Number.isFinite(n) ? n : null;
      }
    }
    out[field] = value === undefined ? null : value;
  }
  return out;
}

function appendRunLog(repoRoot, entry) {
  if (typeof repoRoot !== 'string' || !repoRoot) return { ok: false, error: 'appendRunLog: repoRoot must be a non-empty string' };
  if (!path.isAbsolute(repoRoot)) return { ok: false, error: 'path-traversal: repoRoot must be absolute' };
  let normalized;
  try { normalized = normalizeEntry(entry); } catch (err) { return { ok: false, error: err.message }; }
  const line = JSON.stringify(normalized);
  try { JSON.parse(line); } catch (err) { return { ok: false, error: `round-trip parse failed: ${err.message}` }; }
  const filePath = runLogPath(repoRoot);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    withLock(filePath, () => fs.appendFileSync(filePath, `${line}\n`, 'utf8'));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `append failed: ${err.message}` };
  }
}

function readRunLog(repoRoot) {
  if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot)) return [];
  const filePath = runLogPath(repoRoot);
  if (!fs.existsSync(filePath)) return [];
  try {
    return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try {
        const parsed = JSON.parse(line);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? [parsed] : [];
      } catch (_) {
        return [];
      }
    });
  } catch (_) {
    return [];
  }
}

module.exports = { REQUIRED_FIELDS, appendRunLog, readRunLog, runLogPath };
