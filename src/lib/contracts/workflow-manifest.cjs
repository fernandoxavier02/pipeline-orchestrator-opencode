'use strict';

const setHas = Function.call.bind(Set.prototype.has);

const FULL_STEPS = Object.freeze([
  'classify', 'info-gate', 'proposal', 'plan', 'tdd', 'execute', 'adversarial', 'sanity', 'final',
]);

const FULL_AGENTS_BY_STEP = Object.freeze({
  classify: Object.freeze(['task-orchestrator']),
  'info-gate': Object.freeze(['information-gate']),
  plan: Object.freeze(['plan-architect']),
  tdd: Object.freeze(['quality-gate-router', 'pre-tester']),
  execute: Object.freeze(['executor-controller']),
  adversarial: Object.freeze(['review-orchestrator']),
  sanity: Object.freeze(['sanity-checker']),
  final: Object.freeze(['final-validator']),
});

const FULL_STEP_OBLIGATIONS = Object.freeze({
  classify: Object.freeze({ result_required: true, evidence_required: false }),
  'info-gate': Object.freeze({ result_required: true, evidence_required: false }),
  proposal: Object.freeze({ result_required: false, evidence_required: false }),
  plan: Object.freeze({ result_required: true, evidence_required: false }),
  tdd: Object.freeze({ result_required: true, evidence_required: true }),
  execute: Object.freeze({ result_required: true, evidence_required: true }),
  adversarial: Object.freeze({ result_required: true, evidence_required: true }),
  sanity: Object.freeze({ result_required: true, evidence_required: true }),
  final: Object.freeze({ result_required: true, evidence_required: false }),
});

const TERMINAL_STATES = Object.freeze([
  'completed', 'hard_failed', 'aborted_by_user', 'cancelled',
]);
const TERMINAL_SET = new Set(TERMINAL_STATES);

const DENY_EXCEPTIONS = Object.freeze({
  state_corrupt_governed: 'deny',
  ungoverned: 'allow',
  state_absent: 'allow',
  state_unsigned: 'allow',
  state_corrupt_ungoverned: 'allow',
});

const WORKFLOWS = Object.freeze({
  FULL: Object.freeze({
    steps: FULL_STEPS,
    agents_by_step: FULL_AGENTS_BY_STEP,
    step_obligations: FULL_STEP_OBLIGATIONS,
    terminal_states: TERMINAL_STATES,
  }),
  DIAGNOSTIC: Object.freeze({
    steps: null, agents_by_step: null, step_obligations: null, terminal_states: TERMINAL_STATES,
  }),
  'REVIEW-ONLY': Object.freeze({
    steps: null, agents_by_step: null, step_obligations: null, terminal_states: TERMINAL_STATES,
  }),
  HOTFIX: Object.freeze({
    steps: null, agents_by_step: null, step_obligations: null, terminal_states: TERMINAL_STATES,
  }),
  PAPERCLIP: Object.freeze({
    steps: null, agents_by_step: null, step_obligations: null, terminal_states: TERMINAL_STATES,
  }),
  Spec: Object.freeze({
    steps: null, agents_by_step: null, step_obligations: null, terminal_states: TERMINAL_STATES,
  }),
  brainstorm: Object.freeze({
    steps: null, agents_by_step: null, step_obligations: null, terminal_states: TERMINAL_STATES,
  }),
});

function workflow(workflowKey) {
  return Object.prototype.hasOwnProperty.call(WORKFLOWS, workflowKey) ? WORKFLOWS[workflowKey] : null;
}

function nextAllowedAgents(workflowKey, currentStep) {
  const wf = workflow(workflowKey);
  if (!wf || !Array.isArray(wf.steps) || !wf.agents_by_step) return [];
  const idx = wf.steps.indexOf(currentStep);
  if (idx < 0 || idx + 1 >= wf.steps.length) return [];
  for (let i = idx + 1; i < wf.steps.length; i += 1) {
    const leaves = wf.agents_by_step[wf.steps[i]];
    if (Array.isArray(leaves) && leaves.length) return leaves.slice();
  }
  return [];
}

function isTransitionAllowed(workflowKey, fromStep, toStep) {
  const wf = workflow(workflowKey);
  if (!wf) return true;
  if (!Array.isArray(wf.steps)) return true;
  const fi = wf.steps.indexOf(fromStep);
  const ti = wf.steps.indexOf(toStep);
  if (fi < 0 || ti < 0) return true;
  return ti > fi;
}

function resultRequired(workflowKey, step) {
  const wf = workflow(workflowKey);
  if (!wf || !wf.step_obligations) return false;
  const obligation = wf.step_obligations[step];
  return !!(obligation && obligation.result_required);
}

function evidenceRequired(workflowKey, step) {
  const wf = workflow(workflowKey);
  if (!wf || !wf.step_obligations) return false;
  const obligation = wf.step_obligations[step];
  return !!(obligation && obligation.evidence_required);
}

function buildEvidenceRequired(workflowKey) {
  const wf = workflow(workflowKey);
  if (!wf || !Array.isArray(wf.steps) || !wf.step_obligations) return {};
  const out = {};
  for (const step of wf.steps) {
    const obligation = wf.step_obligations[step];
    out[step] = !!(obligation && obligation.evidence_required);
  }
  return out;
}

function isTerminal(state) {
  return setHas(TERMINAL_SET, state);
}

function denyException(condition) {
  if (Object.prototype.hasOwnProperty.call(DENY_EXCEPTIONS, condition)) return DENY_EXCEPTIONS[condition];
  return 'allow';
}

module.exports = {
  WORKFLOWS,
  TERMINAL_STATES,
  DENY_EXCEPTIONS,
  nextAllowedAgents,
  isTransitionAllowed,
  resultRequired,
  evidenceRequired,
  buildEvidenceRequired,
  isTerminal,
  denyException,
};
