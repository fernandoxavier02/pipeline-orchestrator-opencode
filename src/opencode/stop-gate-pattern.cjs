'use strict';

const fs = require('node:fs');
const path = require('node:path');

const lock = require('../lib/exclusive-lock.cjs');
const signer = require('../lib/sentinel-state-signer.cjs');
const {
  CORRUPT_SENTINEL,
  discoverStatePath,
  findActiveSentinelState,
} = require('../state/sentinel-state-inspector.cjs');
const { projectDirFromInput } = require('./step-ledger-gate.cjs');

const IDLE_HOOK_MARKER = Symbol.for('pipeline-orchestrator.stop-gate-pattern.session.idle.processed');
const CONTINUITY_CAP = 3;
const TERMINAL_STATES = new Set(['completed', 'hard_failed', 'aborted_by_user', 'cancelled']);

function normalizeEventName(input) {
  const rawEvent = input && input.event;
  const eventName = (rawEvent && typeof rawEvent === 'object' ? rawEvent.type : rawEvent)
    || (input && (input.eventName || input.hook || input.hookName));
  return String(eventName || '').trim().toLowerCase();
}

function isSessionIdle(input) {
  return normalizeEventName(input) === 'session.idle';
}

function isTerminal(state) {
  return !!(state && (TERMINAL_STATES.has(state.terminal_state) || TERMINAL_STATES.has(state.status)));
}

function runIdFromState(state) {
  return (state && typeof state.runId === 'string' && state.runId)
    || (state && typeof state.run_id === 'string' && state.run_id)
    || 'unknown';
}

function phaseFromState(state) {
  return (state && typeof state.currentPhase === 'string' && state.currentPhase)
    || (state && typeof state.current_phase === 'string' && state.current_phase)
    || (state && typeof state.phase === 'string' && state.phase)
    || 'unknown';
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

function loadActiveState(projectDir, options = {}) {
  const reader = options.findActiveSentinelState || findActiveSentinelState;
  try { return reader(projectDir); } catch (_) { return null; }
}

function appendProtocolEvent(runDir, event) {
  try {
    fs.mkdirSync(runDir, { recursive: true });
    fs.appendFileSync(path.join(runDir, 'protocol-events.jsonl'), `${JSON.stringify(event).replace(/[\r\n]+/g, ' ')}\n`);
    return true;
  } catch (_) {
    return false;
  }
}

function mutateState(statePath, mutate) {
  if (!statePath) return false;
  const doWrite = () => {
    let state;
    try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (_) { return false; }
    try {
      const verification = signer.verifyState(state);
      if (!verification.valid && !verification.unsigned && !verification.key_unavailable) return false;
    } catch (_) {
      return false;
    }
    const changed = mutate(state);
    if (!changed) return false;
    state.updatedAt = new Date().toISOString();
    state.state_version = Number.isFinite(state.state_version) ? state.state_version + 1 : 1;
    signer.writeSignedState(statePath, state);
    return changed;
  };
  try { return lock.withLock(statePath, doWrite, { maxAttempts: 1, retryMs: 0 }); } catch (_) { return false; }
}

function buildStopAttemptEvent(state, attempt, nowIso) {
  const event = {
    event: 'PIPELINE_STOP_ATTEMPT',
    mode: 'observer_only',
    run_id: runIdFromState(state),
    phase: phaseFromState(state),
    continuity_attempt: attempt,
    decided_by: 'stop-gate-pattern',
    detail: 'OpenCode cannot deterministically block session stop; this is audit plus continuity accounting.',
    ts: nowIso || new Date().toISOString(),
  };
  if (attempt >= CONTINUITY_CAP) event.terminal_state = 'hard_failed';
  return event;
}

function decideStopGatePattern(ctx) {
  if (!ctx || typeof ctx !== 'object') return { decision: 'allow' };
  if (!isSessionIdle(ctx.input)) return { decision: 'allow' };
  if (!ctx.projectDir) return { decision: 'allow' };
  const state = ctx.state;
  if (!state || state === CORRUPT_SENTINEL) return { decision: 'allow' };
  if (state.pipeline_active !== true || isTerminal(state)) return { decision: 'allow' };
  const prior = Number.isFinite(state.continuity_attempts) ? state.continuity_attempts : 0;
  const attempt = prior + 1;
  return {
    decision: 'observe',
    statePath: ctx.statePath,
    runDir: ctx.statePath ? path.dirname(ctx.statePath) : null,
    nowIso: ctx.nowIso,
  };
}

function markOnce(target) {
  if (!target || typeof target !== 'object') return true;
  if (target[IDLE_HOOK_MARKER]) return false;
  Object.defineProperty(target, IDLE_HOOK_MARKER, { value: true, enumerable: false, configurable: false });
  return true;
}

function gatherContext(input, options = {}) {
  const projectDir = projectDirFromInput(input, options);
  const statePath = projectDir ? statePathForProject(projectDir, options) : null;
  return {
    input,
    projectDir,
    statePath,
    state: projectDir ? loadActiveState(projectDir, options) : null,
    nowIso: options.nowIso,
  };
}

function persistAttempt(result) {
  if (!result || result.decision !== 'observe' || !result.statePath) return false;
  return mutateState(result.statePath, (state) => {
    if (isTerminal(state)) return false;
    const prior = Number.isFinite(state.continuity_attempts) ? state.continuity_attempts : 0;
    const attempt = prior + 1;
    state.continuity_attempts = attempt;
    if (attempt >= CONTINUITY_CAP) {
      state.terminal_state = 'hard_failed';
      state.status = 'hard_failed';
      state.hard_failed_at = Date.now();
      state.pipeline_active = false;
    }
    return { attempt, event: buildStopAttemptEvent(state, attempt, result.nowIso) };
  });
}

function handleSessionIdle(input, output = {}, options = {}) {
  if (!markOnce(output)) return output;
  const result = decideStopGatePattern(gatherContext(input, options));
  if (result.decision === 'observe') {
    const persisted = persistAttempt(result);
    if (persisted && result.runDir) appendProtocolEvent(result.runDir, persisted.event);
    result.attempt = persisted && persisted.attempt;
    result.event = persisted && persisted.event;
  }
  if (typeof options.audit === 'function') {
    try { options.audit({ type: `stop-gate-pattern.${result.decision}`, attempt: result.attempt, event: result.event && result.event.event }); } catch (_) { /* observer never blocks */ }
  }
  return output;
}

function createStopGatePatternHooks(options = {}) {
  return {
    event: (input, output = {}) => handleSessionIdle(input, output, options),
    'session.idle': (input, output = {}) => handleSessionIdle({ ...input, event: 'session.idle' }, output, options),
  };
}

module.exports = {
  IDLE_HOOK_MARKER,
  CONTINUITY_CAP,
  TERMINAL_STATES,
  normalizeEventName,
  isSessionIdle,
  isTerminal,
  runIdFromState,
  phaseFromState,
  statePathForProject,
  loadActiveState,
  appendProtocolEvent,
  mutateState,
  buildStopAttemptEvent,
  decideStopGatePattern,
  gatherContext,
  persistAttempt,
  handleSessionIdle,
  createStopGatePatternHooks,
};
