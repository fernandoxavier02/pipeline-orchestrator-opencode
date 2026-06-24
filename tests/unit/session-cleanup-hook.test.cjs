'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const cleanup = require('../../src/opencode/session-cleanup-hook.cjs');
const plugin = require('../../src/opencode/pipeline-adaptation-plugin.cjs');
const opencodeIndex = require('../../src/opencode/index.cjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sentinel(overrides = {}) {
  return {
    schemaVersion: 'SENTINEL_STATE/v1',
    runId: 'run-session-cleanup',
    currentPhase: 'phase_cleanup',
    checkpoints: {},
    blocked: false,
    stopRuleTriggered: false,
    lastValidEventId: null,
    updatedAt: '2026-06-24T00:01:00.000Z',
    pipeline_active: true,
    workflow_key: 'FULL',
    task_type: 'feature',
    complexity: 'medium',
    ...overrides,
  };
}

function projectWithSession(state) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w7-3-cleanup-'));
  const runDir = path.join(project, '.pipeline', 'docs', 'Pre-feature-action', state.runId || state.run_id || 'run-session-cleanup');
  writeJson(path.join(runDir, 'sentinel-state.json'), state);
  writeJson(path.join(project, '.pipeline', 'active-run.json'), { pipeline_doc_path: runDir, run_id: state.runId || state.run_id, updated_at: '2026-06-24T00:01:00.000Z' });
  return { project, runDir, sessionsDir: path.join(project, '.pipeline', 'sessions') };
}

function writeSessionFiles(project, sessionId = 'session-cleanup') {
  const sessionsDir = path.join(project, '.pipeline', 'sessions');
  writeJson(path.join(sessionsDir, 'active.lock'), { session_id: sessionId, status: 'active', created_at: Date.now(), expires_at: Date.now() + 60_000 });
  writeJson(path.join(sessionsDir, 'active.exec-window'), { session_id: sessionId, ttl_minutes: 5 });
  writeJson(path.join(sessionsDir, 'other.lock'), { session_id: 'other-session', status: 'active', created_at: Date.now(), expires_at: Date.now() + 60_000 });
  writeJson(path.join(sessionsDir, 'other.exec-window'), { session_id: 'other-session', ttl_minutes: 5 });
  return sessionsDir;
}

function idleInput(project, sessionId = 'session-cleanup') {
  return { cwd: project, session_id: sessionId, event: { type: 'session.idle' } };
}

const activeRun = projectWithSession(sentinel());
writeSessionFiles(activeRun.project);
cleanup.handleSessionCleanup(idleInput(activeRun.project), {}, { nowMs: 123 });
assert.equal(readJson(path.join(activeRun.sessionsDir, 'active.lock')).status, 'active');
assert.equal(fs.existsSync(path.join(activeRun.sessionsDir, 'active.exec-window')), false);
assert.equal(readJson(path.join(activeRun.sessionsDir, 'other.lock')).status, 'active');
assert.equal(fs.existsSync(path.join(activeRun.sessionsDir, 'other.exec-window')), true);

const terminalRun = projectWithSession(sentinel({ runId: 'run-session-cleanup-terminal', pipeline_active: false, terminal_state: 'completed', status: 'completed' }));
writeSessionFiles(terminalRun.project);
cleanup.handleSessionCleanup(idleInput(terminalRun.project), {}, { nowMs: 456 });
const terminalLock = readJson(path.join(terminalRun.sessionsDir, 'active.lock'));
assert.equal(terminalLock.status, 'completed');
assert.equal(terminalLock.completed_at, 456);
assert.equal(fs.existsSync(path.join(terminalRun.sessionsDir, 'active.exec-window')), false);

const expired = projectWithSession(sentinel({ runId: 'run-session-cleanup-expired' }));
writeSessionFiles(expired.project);
writeJson(path.join(expired.sessionsDir, 'expired.lock'), { session_id: 'session-cleanup', status: 'active', created_at: 1, expires_at: 2 });
cleanup.handleSessionCleanup(idleInput(expired.project), {}, { nowMs: 1_000 });
assert.equal(fs.existsSync(path.join(expired.sessionsDir, 'expired.lock')), false);

const tempAttack = projectWithSession(sentinel({ runId: 'run-session-cleanup-temp-attack', pipeline_active: false, terminal_state: 'completed', status: 'completed' }));
writeSessionFiles(tempAttack.project);
const outsideTempTarget = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'po-w7-3-temp-target-')), 'target.json');
writeJson(outsideTempTarget, { untouched: true });
const maliciousTmp = path.join(tempAttack.sessionsDir, 'active.lock.fixed.tmp');
try { fs.symlinkSync(outsideTempTarget, maliciousTmp, 'file'); } catch (_) { fs.writeFileSync(maliciousTmp, 'preexisting'); }
cleanup.handleSessionCleanup(idleInput(tempAttack.project), {}, { nowMs: 1_001, tmpSuffix: () => 'fixed' });
assert.deepEqual(readJson(outsideTempTarget), { untouched: true });

const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w7-3-plain-'));
const plainSessions = writeSessionFiles(plain);
cleanup.handleSessionCleanup(idleInput(plain), {}, { nowMs: 789 });
const plainLock = readJson(path.join(plainSessions, 'active.lock'));
assert.equal(plainLock.status, 'completed');
assert.equal(plainLock.completed_at, 789);

const symlinkProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w7-3-symlink-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w7-3-outside-'));
writeJson(path.join(outside, 'active.lock'), { session_id: 'session-cleanup', status: 'active' });
fs.mkdirSync(path.join(symlinkProject, '.pipeline'), { recursive: true });
fs.symlinkSync(outside, path.join(symlinkProject, '.pipeline', 'sessions'), process.platform === 'win32' ? 'junction' : 'dir');
cleanup.handleSessionCleanup(idleInput(symlinkProject), {}, { nowMs: 999 });
assert.equal(readJson(path.join(outside, 'active.lock')).status, 'active');

const hooks = cleanup.createSessionCleanupHooks({ projectDir: () => plain, nowMs: 1000 });
assert.equal(typeof hooks.event, 'function');
assert.equal(typeof hooks['session.idle'], 'function');

const pluginProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w7-3-plugin-'));
const pluginSessions = writeSessionFiles(pluginProject, 'session-plugin');
const pluginHooks = plugin.createPipelineAdaptationHooks({ directory: pluginProject }, { nowMs: 1001 });
pluginHooks.event(idleInput(pluginProject, 'session-plugin'), {});
assert.equal(readJson(path.join(pluginSessions, 'active.lock')).status, 'completed');

assert.equal(typeof opencodeIndex.createSessionCleanupHooks, 'function');

console.log('session cleanup hook OK');
