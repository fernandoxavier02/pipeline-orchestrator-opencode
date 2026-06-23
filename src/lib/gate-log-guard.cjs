'use strict';

const { setHas } = require('./read-only-set.cjs');

const REQUIRED_GATES_BEFORE = Object.freeze({
  'executor-controller': Object.freeze(['TDD_APPROVAL']),
  'final-validator': Object.freeze(['ADVERSARIAL_GATE']),
});

function buildGateLogReason(agentLeaf, missing) {
  return `GATE_LOG_MISSING: ${agentLeaf} requires these gate decisions logged first: [${missing.join(', ')}]`;
}

function decideGateLog(ctx) {
  if (!ctx || typeof ctx !== 'object') return { decision: 'allow' };
  const leaf = ctx.agentLeaf;
  if (typeof leaf !== 'string' || !leaf) return { decision: 'allow' };
  const required = REQUIRED_GATES_BEFORE[leaf];
  if (!Array.isArray(required) || required.length === 0) return { decision: 'allow' };
  const logged = ctx.loggedGates instanceof Set ? ctx.loggedGates : new Set(Array.isArray(ctx.loggedGates) ? ctx.loggedGates : []);
  const missing = required.filter((gate) => !setHas(logged, gate));
  if (missing.length === 0) return { decision: 'allow' };
  if (String(ctx.enforce || 'deny').toLowerCase() === 'warn') return { decision: 'allow', warn: true, missing };
  return { decision: 'block', missing, reason: buildGateLogReason(leaf, missing) };
}

function parseLoggedGates(jsonlText, wantRunId) {
  const out = new Set();
  if (typeof jsonlText !== 'string' || !jsonlText) return out;
  const want = (typeof wantRunId === 'string' && wantRunId) ? wantRunId : null;
  for (const line of jsonlText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try { obj = JSON.parse(trimmed); } catch (_) { continue; }
    if (obj && typeof obj === 'object' && typeof obj.gate === 'string') {
      const recordRunId = typeof obj.run_id === 'string' && obj.run_id ? obj.run_id : obj.runId;
      if (want && typeof recordRunId === 'string' && recordRunId && recordRunId !== want) continue;
      const gate = obj.gate.trim();
      if (gate) out.add(gate);
    }
  }
  return out;
}

module.exports = { decideGateLog, parseLoggedGates, buildGateLogReason, REQUIRED_GATES_BEFORE };
