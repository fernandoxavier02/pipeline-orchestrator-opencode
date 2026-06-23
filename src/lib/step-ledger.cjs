'use strict';

const STEP_MANIFESTS = Object.freeze({
  FULL: Object.freeze(['classify', 'info-gate', 'proposal', 'plan', 'tdd', 'execute', 'adversarial', 'sanity', 'final']),
  Spec: Object.freeze(['classify', 'clarify', 'requirements', 'validate-gap', 'design', 'validate-design', 'tasks', 'review', 'seal']),
  brainstorm: Object.freeze(['intake', 'explore', 'alternatives', 'spec-init', 'requirements', 'design', 'tasks', 'handoff']),
});

const AGENT_STEP_MAP = Object.freeze({
  FULL: Object.freeze({
    'task-orchestrator': 'classify',
    'information-gate': 'info-gate',
    'plan-architect': 'plan',
    'quality-gate-router': 'tdd',
    'pre-tester': 'tdd',
    'executor-controller': 'execute',
    'review-orchestrator': 'adversarial',
    'sanity-checker': 'sanity',
    'final-validator': 'final',
  }),
});

function buildStepReason(attempted, missing) {
  return `STEP_LEDGER_VIOLATION: o passo '${attempted}' exige passos anteriores: [${missing.join(', ')}].`;
}

function decideStep(ctx) {
  if (!ctx || typeof ctx !== 'object') return { decision: 'allow' };
  const required = Array.isArray(ctx.requiredSteps) ? ctx.requiredSteps : [];
  const attempted = ctx.attemptedStep;
  if (typeof attempted !== 'string' || !attempted) return { decision: 'allow' };
  const idx = required.indexOf(attempted);
  if (idx < 0) return { decision: 'allow' };
  const stamped = new Set(Array.isArray(ctx.stampedSteps) ? ctx.stampedSteps : []);
  const missing = required.slice(0, idx).filter((step) => !stamped.has(step));
  if (missing.length === 0) return { decision: 'allow' };
  if (String(ctx.enforce || 'deny').toLowerCase() === 'warn') return { decision: 'allow', warn: true, missing };
  return { decision: 'block', missing, reason: buildStepReason(attempted, missing) };
}

function requiredStepsFor(workflowKey) {
  return STEP_MANIFESTS[workflowKey] ? STEP_MANIFESTS[workflowKey].slice() : [];
}

function stepForAgent(workflowKey, agentLeaf) {
  const map = AGENT_STEP_MAP[workflowKey] || {};
  return (agentLeaf && map[agentLeaf]) || null;
}

function agentStepsFor(workflowKey) {
  const agentSteps = new Set(Object.values(AGENT_STEP_MAP[workflowKey] || {}));
  return requiredStepsFor(workflowKey).filter((step) => agentSteps.has(step));
}

function decideAgentSpawn(ctx) {
  if (!ctx || typeof ctx !== 'object') return { decision: 'allow' };
  const leaf = String(ctx.agentType || '').split(':').pop();
  const step = stepForAgent(ctx.workflowKey, leaf);
  if (!step) return { decision: 'allow' };
  return decideStep({
    requiredSteps: agentStepsFor(ctx.workflowKey),
    stampedSteps: ctx.stampedSteps,
    attemptedStep: step,
    enforce: ctx.enforce,
  });
}

module.exports = { decideStep, requiredStepsFor, buildStepReason, STEP_MANIFESTS, AGENT_STEP_MAP, stepForAgent, agentStepsFor, decideAgentSpawn };
