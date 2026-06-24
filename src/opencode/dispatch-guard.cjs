'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  CORRUPT_SENTINEL,
  discoverStatePath,
  findActiveSentinelState,
} = require('../state/sentinel-state-inspector.cjs');
const {
  canonicalAgentLeaf,
  projectDirFromInput,
  rawAgentNameFromInput,
} = require('./step-ledger-gate.cjs');

const BEFORE_HOOK_MARKER = Symbol.for('pipeline-orchestrator.dispatch-guard.tool.execute.before.processed');
const PLAN_MODE_MANDATORY_LEAVES = new Set(['plan-architect', 'pre-tester', 'executor-controller', 'executor-implementer-task']);
const PLAN_MODE_MANDATORY_FQNS = new Set([
  'pipeline-orchestrator:quality:plan-architect',
  'pipeline-orchestrator:quality:pre-tester',
  'pipeline-orchestrator:executor:executor-controller',
  'pipeline-orchestrator:executor:executor-implementer-task',
]);
const BRAINSTORM_TARGET_LEAVES = new Set(['executor-controller', 'executor-implementer-task', 'feature-implementer']);
const BRAINSTORM_TARGET_FQNS = new Set([
  'pipeline-orchestrator:executor:executor-controller',
  'pipeline-orchestrator:executor:executor-implementer-task',
  'pipeline-orchestrator:executor:type-specific:feature-implementer',
]);
const BRAINSTORM_BRANCH_VALUES = new Set(['load-existing', 'dispatch-brainstorm', 'no-prep-override', 'simples-bypass']);
const MARKER_TTL_MS = 24 * 60 * 60 * 1000;

function normalizeToolName(toolName) {
  return String(toolName || '').trim().toLowerCase();
}

function isDispatchTool(input) {
  const toolName = normalizeToolName(input && (input.tool || input.toolName || input.tool_name));
  return toolName === 'task' || toolName === 'agent' || toolName === 'skill';
}

function argsFromInput(input, output = {}) {
  const inputArgs = input && (input.args || input.tool_input) && typeof (input.args || input.tool_input) === 'object'
    ? (input.args || input.tool_input)
    : {};
  const topLevel = {};
  for (const key of ['subagent_type', 'agentName', 'agent', 'name', 'skill', 'prompt']) {
    if (input && typeof input[key] === 'string') topLevel[key] = input[key];
  }
  return { ...topLevel, ...inputArgs };
}

function argsFromOutput(output = {}) {
  return output && output.args && typeof output.args === 'object' ? output.args : {};
}

function targetFromInput(input, output = {}) {
  const args = argsFromInput(input, output);
  return args.subagent_type || args.agentName || args.agent || args.name || args.skill || rawAgentNameFromInput(input) || '';
}

function promptFromInput(input, output = {}) {
  const args = argsFromInput(input, output);
  return typeof args.prompt === 'string' ? args.prompt : '';
}

function outputOverridesDispatch(input, output = {}) {
  const outputArgs = argsFromOutput(output);
  const outputTarget = outputArgs.subagent_type || outputArgs.agentName || outputArgs.agent || outputArgs.name || outputArgs.skill;
  const inputTarget = targetFromInput(input, {});
  if (outputTarget && !inputTarget) return true;
  if (outputTarget && inputTarget && outputTarget !== inputTarget) return true;
  if (typeof outputArgs.prompt === 'string') {
    const inputPrompt = promptFromInput(input, {});
    if (!inputPrompt) return true;
    if (inputPrompt && outputArgs.prompt !== inputPrompt) return true;
  }
  return false;
}

function targetLeaf(target) {
  return canonicalAgentLeaf(String(target || '').split(':').pop());
}

function safeSlug(value) {
  return String(value || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'unknown';
}

function sanitizeForReason(value, max = 80) {
  return String(value == null ? '' : value).slice(0, max).replace(/[^\x20-\x7E]/g, '');
}

function statePathForProject(projectDir, options = {}) {
  const discover = options.discoverStatePath || discoverStatePath;
  try {
    const discovered = discover(projectDir);
    return discovered && discovered.statePath ? discovered.statePath : null;
  } catch (_) {
    return null;
  }
}

function normalizeCase(value) {
  return process.platform === 'win32' ? String(value).toLowerCase() : String(value);
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
    const real = (fs.realpathSync.native || fs.realpathSync)(current);
    return missing.length > 0 ? path.join(real, ...missing) : real;
  } catch (_) {
    return resolved;
  }
}

function isContained(parent, child) {
  try {
    const relative = path.relative(normalizeCase(resolveExistingPrefix(parent)), normalizeCase(resolveExistingPrefix(child)));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  } catch (_) {
    return false;
  }
}

function safeRunDir(projectDir, runDir) {
  if (!projectDir || !runDir) return false;
  return isContained(path.join(projectDir, '.pipeline'), runDir);
}

function runDirFromProject(projectDir, options = {}) {
  const statePath = statePathForProject(projectDir, options);
  return statePath ? path.dirname(statePath) : null;
}

function loadActiveState(projectDir, options = {}) {
  const reader = options.findActiveSentinelState || findActiveSentinelState;
  try { return reader(projectDir); } catch (_) { return null; }
}

function appendProtocolEvent(runDir, event, options = {}) {
  if (!runDir || !safeRunDir(options.projectDir, runDir)) return false;
  try {
    fs.mkdirSync(runDir, { recursive: true });
    const line = JSON.stringify({ ...event, ts: options.nowIso || new Date().toISOString() }).replace(/[\r\n]+/g, ' ');
    fs.appendFileSync(path.join(runDir, 'protocol-events.jsonl'), `${line}\n`);
    return true;
  } catch (_) {
    return false;
  }
}

function markerPath(runDir, prefix, leaf) {
  return path.join(runDir, `${prefix}-${safeSlug(leaf)}.json`);
}

function readMarker(runDir, prefix, leaf, state, options = {}) {
  if (!safeRunDir(options.projectDir, runDir)) return null;
  try {
    const filePath = markerPath(runDir, prefix, leaf);
    if (fs.statSync(filePath).size > 4096) return null;
    const marker = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return null;
    const currentRun = runIdFromState(state);
    if (currentRun && marker.run_id !== currentRun) return null;
    const age = Date.parse(options.nowIso || new Date().toISOString()) - Date.parse(marker.ts || '');
    if (!Number.isFinite(age) || age < 0 || age >= MARKER_TTL_MS) return null;
    return marker;
  } catch (_) {
    return null;
  }
}

function writeMarker(runDir, prefix, leaf, state, options = {}) {
  if (!safeRunDir(options.projectDir, runDir)) return false;
  try {
    fs.writeFileSync(markerPath(runDir, prefix, leaf), JSON.stringify({
      run_id: runIdFromState(state) || null,
      ts: options.nowIso || new Date().toISOString(),
    }, null, 2) + '\n');
    return true;
  } catch (_) {
    return false;
  }
}

function clearMarker(runDir, prefix, leaf) {
  try { fs.rmSync(markerPath(runDir, prefix, leaf), { force: true }); return true; } catch (_) { return false; }
}

function runIdFromState(state) {
  return (state && typeof state.runId === 'string' && state.runId)
    || (state && typeof state.run_id === 'string' && state.run_id)
    || '';
}

function isPlanModeMandatoryTarget(target) {
  if (!target) return false;
  const leaf = targetLeaf(target);
  return PLAN_MODE_MANDATORY_FQNS.has(target)
    || PLAN_MODE_MANDATORY_LEAVES.has(leaf);
}

function hasPlanModeResults(prompt) {
  return /^PLAN_MODE_RESULTS\b/m.test(String(prompt || ''));
}

function decidePlanModeDispatch(ctx) {
  const target = ctx.target;
  if (!isPlanModeMandatoryTarget(target)) return { decision: 'allow' };
  const leaf = targetLeaf(target);
  if (hasPlanModeResults(ctx.prompt)) {
    clearMarker(ctx.runDir, 'plan-mode-pending', leaf);
    return { decision: 'allow', code: 'PLAN_MODE_RESULTS' };
  }
  const pending = readMarker(ctx.runDir, 'plan-mode-pending', leaf, ctx.state, ctx.options);
  if (!pending) writeMarker(ctx.runDir, 'plan-mode-pending', leaf, ctx.state, ctx.options);
  appendProtocolEvent(ctx.runDir, {
      event: 'PLAN_MODE_BYPASS',
      agent: leaf,
      phase: 'pre-dispatch',
      detail: `${sanitizeForReason(leaf)} dispatched without PLAN_MODE_RESULTS`,
      decided_by: 'dispatch-guard',
  }, ctx.options);
  if (String(process.env.PIPELINE_PLAN_MODE_ENFORCEMENT || 'deny').toLowerCase() === 'warn') {
    return { decision: 'allow', warn: true, code: 'PLAN_MODE_BYPASS', leaf };
  }
  return {
    decision: 'block',
    code: 'PLAN_MODE_BYPASS',
    reason: `PLAN_MODE_BYPASS: ${sanitizeForReason(leaf)} was dispatched without PLAN_MODE_RESULTS. Complete the Plan Mode round-trip before retrying.`,
    leaf,
  };
}

function isBrainstormTarget(target) {
  if (!target) return false;
  const targetText = String(target);
  const leaf = targetLeaf(targetText);
  return BRAINSTORM_TARGET_FQNS.has(targetText)
    || BRAINSTORM_TARGET_LEAVES.has(leaf);
}

function isBrainstormInScope(state) {
  const decision = state && state.orchestrator_decision && typeof state.orchestrator_decision === 'object'
    ? state.orchestrator_decision
    : {};
  const complexity = String(decision.complexity || state.complexity || '').trim().toUpperCase();
  const type = String(decision.type || state.task_type || state.type || '').trim().toUpperCase();
  return complexity === 'MEDIA' || complexity === 'COMPLEXA' || type === 'SPEC';
}

function hasValidStep17(state) {
  const block = state && state.step_1_7 && typeof state.step_1_7 === 'object' && !Array.isArray(state.step_1_7)
    ? state.step_1_7
    : null;
  return !!(block && typeof block.decision === 'string' && BRAINSTORM_BRANCH_VALUES.has(block.decision));
}

function decideBrainstormDispatch(ctx) {
  if (!isBrainstormTarget(ctx.target)) return { decision: 'allow' };
  if (!isBrainstormInScope(ctx.state)) return { decision: 'allow' };
  if (hasValidStep17(ctx.state)) return { decision: 'allow' };
  const leaf = sanitizeForReason(targetLeaf(ctx.target), 80) || 'unknown';
  if (!readMarker(ctx.runDir, 'brainstorm-bypass', leaf, ctx.state, ctx.options)) {
    writeMarker(ctx.runDir, 'brainstorm-bypass', leaf, ctx.state, ctx.options);
    appendProtocolEvent(ctx.runDir, {
      event: 'BRAINSTORM_BYPASS',
      agent: leaf,
      phase: 'pre-dispatch',
      detail: `${leaf} dispatched without STEP 1.7 routing decision`,
      decided_by: 'dispatch-guard',
    }, ctx.options);
  }
  if (String(process.env.PIPELINE_BRAINSTORM_ENFORCEMENT || 'deny').toLowerCase() === 'warn') {
    return { decision: 'allow', warn: true, code: 'BRAINSTORM_BYPASS', leaf };
  }
  return {
    decision: 'block',
    code: 'BRAINSTORM_BYPASS',
    reason: `BRAINSTORM_BYPASS: ${leaf} was dispatched without a valid STEP 1.7 routing decision. Run or record STEP 1.7 before dispatching execution.`,
    leaf,
  };
}

function decideDispatchGuard(ctx) {
  if (!ctx || typeof ctx !== 'object') return { decision: 'allow' };
  if (!ctx.projectDir || !ctx.runDir) return { decision: 'allow' };
  if (!isDispatchTool(ctx.input)) return { decision: 'allow' };
  if (!safeRunDir(ctx.projectDir, ctx.runDir)) return { decision: 'block', code: 'DISPATCH_GUARD_PATH_ESCAPE', reason: 'DISPATCH_GUARD_PATH_ESCAPE: run directory is outside the project pipeline directory.' };
  if (outputOverridesDispatch(ctx.input, ctx.output)) return { decision: 'block', code: 'DISPATCH_TARGET_MUTATED', reason: 'DISPATCH_TARGET_MUTATED: dispatch target or prompt was changed before guard evaluation.' };
  if (!ctx.state) return { decision: 'allow' };
  if (ctx.state === CORRUPT_SENTINEL) return { decision: 'block', code: 'DISPATCH_GUARD_STATE_CORRUPT', reason: 'DISPATCH_GUARD_STATE_CORRUPT: sentinel-state is unreadable, so dispatch cannot be verified.' };
  if (ctx.state.pipeline_active !== true) return { decision: 'allow' };
  const plan = decidePlanModeDispatch(ctx);
  if (plan.decision === 'block') return plan;
  const brainstorm = decideBrainstormDispatch(ctx);
  if (brainstorm.decision === 'block' || brainstorm.warn) return brainstorm;
  if (plan.warn) return plan;
  return { decision: 'allow' };
}

function markOnce(target) {
  if (!target || typeof target !== 'object') return true;
  if (target[BEFORE_HOOK_MARKER]) return false;
  Object.defineProperty(target, BEFORE_HOOK_MARKER, { value: true, enumerable: false, configurable: false });
  return true;
}

function gatherContext(input, output = {}, options = {}) {
  const projectDir = projectDirFromInput(input, options);
  const guardOptions = { ...options, projectDir };
  return {
    input,
    output,
    options: guardOptions,
    projectDir,
    runDir: projectDir ? runDirFromProject(projectDir, guardOptions) : null,
    state: projectDir ? loadActiveState(projectDir, guardOptions) : null,
    target: targetFromInput(input, output),
    prompt: promptFromInput(input, output),
  };
}

function handleToolExecuteBefore(input, output = {}, options = {}) {
  if (!markOnce(output)) return output;
  if (output.error) return output;
  const result = decideDispatchGuard(gatherContext(input, output, options));
  if (result.decision === 'block') {
    output.error = { code: result.code || 'DISPATCH_GUARD_BLOCKED', reason: result.reason, agent: result.leaf };
  } else if (result.warn) {
    output.warning = { code: result.code || 'DISPATCH_GUARD_WARNING', agent: result.leaf };
  }
  if (typeof options.audit === 'function') {
    try { options.audit({ type: `dispatch-guard.${result.decision}`, result }); } catch (_) { /* never block */ }
  }
  return output;
}

function createDispatchGuardHooks(options = {}) {
  return {
    'tool.execute.before': (input, output = {}) => handleToolExecuteBefore(input, output, options),
  };
}

module.exports = {
  BEFORE_HOOK_MARKER,
  CORRUPT_SENTINEL,
  PLAN_MODE_MANDATORY_LEAVES,
  PLAN_MODE_MANDATORY_FQNS,
  BRAINSTORM_TARGET_LEAVES,
  BRAINSTORM_TARGET_FQNS,
  BRAINSTORM_BRANCH_VALUES,
  MARKER_TTL_MS,
  normalizeToolName,
  isDispatchTool,
  argsFromInput,
  targetFromInput,
  promptFromInput,
  argsFromOutput,
  outputOverridesDispatch,
  targetLeaf,
  safeSlug,
  sanitizeForReason,
  statePathForProject,
  normalizeCase,
  resolveExistingPrefix,
  isContained,
  safeRunDir,
  runDirFromProject,
  loadActiveState,
  appendProtocolEvent,
  markerPath,
  readMarker,
  writeMarker,
  clearMarker,
  runIdFromState,
  isPlanModeMandatoryTarget,
  hasPlanModeResults,
  decidePlanModeDispatch,
  isBrainstormTarget,
  isBrainstormInScope,
  hasValidStep17,
  decideBrainstormDispatch,
  decideDispatchGuard,
  gatherContext,
  handleToolExecuteBefore,
  createDispatchGuardHooks,
};
