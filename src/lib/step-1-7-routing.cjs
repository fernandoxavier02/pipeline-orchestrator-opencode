'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { withLock } = require('./exclusive-lock.cjs');

const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

const BRANCH_VALUES = Object.freeze([
  'load-existing',
  'dispatch-brainstorm',
  'no-prep-override',
  'simples-bypass',
]);

const BRANCH_SET = new Set(BRANCH_VALUES);

const BRANCH_TO_CANONICAL = Object.freeze({
  'dispatch-brainstorm': 'DISPATCHED',
  'load-existing': 'CONFIRMED',
  'no-prep-override': 'SKIPPED',
  'simples-bypass': 'NOT_TRIGGERED',
});

function branchToCanonical(branch) {
  if (typeof branch !== 'string' || !BRANCH_SET.has(branch)) {
    throw new TypeError(`branchToCanonical: branch "${branch}" not in BRANCH_VALUES. Allowed: ${BRANCH_VALUES.join(', ')}.`);
  }
  return BRANCH_TO_CANONICAL[branch];
}

function sanitizeDetail(value, fallback) {
  if (typeof value !== 'string' || value.trim().length === 0) return fallback;
  return value.replace(/[\t\n\r]/g, ' ').replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, 200) || fallback;
}

function safeIso(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) ? value : new Date().toISOString();
}

function appendJsonl(filePath, entry) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw new TypeError('appendStep17Routing: filePath must be absolute');
  }
  if (filePath.split(/[\\/]+/).includes('..')) {
    throw new Error('appendStep17Routing: filePath must not contain traversal segments');
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const line = JSON.stringify(entry);
  JSON.parse(line);
  withLock(filePath, () => {
    fs.appendFileSync(filePath, `${line}\n`, 'utf8');
  });
}

function appendStep17Routing(filePath, opts = {}) {
  if (!opts || typeof opts !== 'object' || Array.isArray(opts)) {
    throw new TypeError('appendStep17Routing: opts must be a plain object');
  }
  const decision = branchToCanonical(opts.branch);
  const runId = typeof opts.runId === 'string' && SAFE_ID_RE.test(opts.runId) ? opts.runId : null;
  if (!runId) throw new TypeError('appendStep17Routing: runId must be a safe non-empty id');
  const prepId = typeof opts.prep_run_id === 'string' && SAFE_ID_RE.test(opts.prep_run_id) ? opts.prep_run_id : null;
  const entry = {
    schemaVersion: 'GATE_DECISION_RECORD/v1',
    runId,
    gate: 'STEP_1_7_ROUTING',
    hardness: 'HARD',
    phase: sanitizeDetail(opts.phase, '1.7'),
    decision,
    decided_by: sanitizeDetail(opts.decided_by, 'pipeline-controller'),
    timestamp: safeIso(opts.timestamp),
    detail: `branch=${JSON.stringify(opts.branch)}; prep_run_id=${JSON.stringify(prepId)}`,
    confidence_impact: 0,
  };
  appendJsonl(filePath, entry);
  return { ok: true, entry };
}

function buildStep17StateBlock(branch, prepRunId) {
  branchToCanonical(branch);
  return {
    decision: branch,
    prep_run_id: typeof prepRunId === 'string' && SAFE_ID_RE.test(prepRunId) ? prepRunId : null,
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  appendStep17Routing,
  branchToCanonical,
  buildStep17StateBlock,
  BRANCH_VALUES,
  BRANCH_TO_CANONICAL,
};
