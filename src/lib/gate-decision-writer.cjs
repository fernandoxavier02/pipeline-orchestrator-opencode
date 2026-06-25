'use strict';

const path = require('node:path');

const { safeAppendJsonl } = require('./jsonl-sanitizer.cjs');
const {
  CANONICAL_DECISIONS,
  CANONICAL_HARDNESS,
  SCHEMA_VERSION,
} = require('./contracts/gate-decision.cjs');

const PLUGIN_VERSION = 'opencode-local';

function buildCtx(pipelineDocPath, opts = {}) {
  if (typeof pipelineDocPath !== 'string' || pipelineDocPath.length === 0) {
    throw new TypeError('buildCtx: pipelineDocPath must be a non-empty string');
  }
  return {
    run_id: path.basename(pipelineDocPath.replace(/[\\/]+$/, '')),
    plugin_version: PLUGIN_VERSION,
    schema_version: SCHEMA_VERSION,
    type: typeof opts.type === 'string' ? opts.type : null,
    complexity: typeof opts.complexity === 'string' ? opts.complexity : null,
  };
}

function appendGateDecision(filePath, entry, ctx) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new TypeError('appendGateDecision: filePath must be absolute');
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError('appendGateDecision: entry must be a plain object');
  if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) throw new TypeError('appendGateDecision: ctx must be a plain object');
  if (typeof entry.decision !== 'string' || !CANONICAL_DECISIONS.has(entry.decision)) {
    throw new TypeError(`appendGateDecision: decision "${entry.decision}" not in CANONICAL_DECISIONS`);
  }
  if (typeof entry.hardness !== 'string' || !CANONICAL_HARDNESS.has(entry.hardness)) {
    throw new TypeError(`appendGateDecision: hardness "${entry.hardness}" not in CANONICAL_HARDNESS`);
  }
  return safeAppendJsonl(filePath, {
    run_id: ctx.run_id,
    plugin_version: ctx.plugin_version,
    schema_version: ctx.schema_version,
    type: ctx.type,
    complexity: ctx.complexity,
    gate: entry.gate,
    hardness: entry.hardness,
    phase: entry.phase,
    decision: entry.decision,
    decided_by: entry.decided_by,
    timestamp: entry.timestamp,
    detail: entry.detail,
    confidence_impact: entry.confidence_impact,
  });
}

module.exports = {
  CANONICAL_DECISIONS,
  CANONICAL_HARDNESS,
  PLUGIN_VERSION,
  SCHEMA_VERSION,
  appendGateDecision,
  buildCtx,
};
