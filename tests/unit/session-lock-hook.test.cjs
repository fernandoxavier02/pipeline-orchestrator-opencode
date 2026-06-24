'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const lock = require('../../src/opencode/session-lock-hook.cjs');
const plugin = require('../../src/opencode/pipeline-adaptation-plugin.cjs');
const opencodeIndex = require('../../src/opencode/index.cjs');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function project() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'po-w8-4-lock-'));
}

const p = project();
assert.equal(lock.detectPipelineInvocation('/feature-light criar painel'), true);
assert.equal(lock.detectPipelineInvocation('explique o projeto'), false);
assert.equal(lock.isValidSessionId('session-1'), true);
assert.equal(lock.isValidSessionId('../bad'), false);

let output = {};
lock.handlePromptAppend({ cwd: p, session_id: 'session-1', text: '/feature-light criar painel' }, output, { nowMs: 1000 });
assert.equal(output.error, undefined);
let created = readJson(path.join(p, '.pipeline', 'sessions', 'session-1.lock'));
assert.equal(created.session_id, 'session-1');
assert.equal(created.status, 'active');
assert.equal(created.created_at, 1000);
assert.equal(created.last_seen_at, 1000);

lock.handlePromptAppend({ cwd: p, session_id: 'session-1', text: 'ok' }, {}, { nowMs: 2000 });
created = readJson(path.join(p, '.pipeline', 'sessions', 'session-1.lock'));
assert.equal(created.last_seen_at, 2000);

const stale = project();
const sessionsDir = path.join(stale, '.pipeline', 'sessions');
writeJson(path.join(sessionsDir, 'foreign.lock'), {
  session_id: 'foreign',
  status: 'active',
  created_at: 0,
  last_seen_at: 0,
  expires_at: 999999999,
});
lock.handlePromptAppend({ cwd: stale, session_id: 'current', text: 'hello' }, {}, { nowMs: lock.STALE_HEARTBEAT_THRESHOLD_MS + 1 });
const staleLock = readJson(path.join(sessionsDir, 'foreign.lock'));
assert.equal(staleLock.status, 'completed');
assert.equal(staleLock.completed_reason, 'stale_heartbeat');

const invalid = project();
lock.handlePromptAppend({ cwd: invalid, session_id: '../bad', text: '/feature-light criar painel' }, {}, { nowMs: 1000 });
assert.equal(fs.existsSync(path.join(invalid, '.pipeline', 'sessions')), false);

const symlinkProject = project();
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w8-4-outside-'));
try {
  fs.symlinkSync(outside, path.join(symlinkProject, '.pipeline'), 'junction');
  lock.handlePromptAppend({ cwd: symlinkProject, session_id: 'symlink-session', text: '/feature-light criar painel' }, {}, { nowMs: 1000 });
  assert.equal(fs.existsSync(path.join(outside, 'sessions', 'symlink-session.lock')), false);
} catch (error) {
  if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error && error.code)) {
    // Some Windows environments disable symlink creation for non-admin users.
  } else {
    throw error;
  }
}

const sessionsSymlinkProject = project();
fs.mkdirSync(path.join(sessionsSymlinkProject, '.pipeline'), { recursive: true });
const outsideSessions = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w8-4-outside-sessions-'));
try {
  fs.symlinkSync(outsideSessions, path.join(sessionsSymlinkProject, '.pipeline', 'sessions'), 'junction');
  lock.handlePromptAppend({ cwd: sessionsSymlinkProject, session_id: 'sessions-link', text: '/feature-light criar painel' }, {}, { nowMs: 1000 });
  assert.equal(fs.existsSync(path.join(outsideSessions, 'sessions-link.lock')), false);
} catch (error) {
  if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error && error.code)) {
    // Some Windows environments disable symlink creation for non-admin users.
  } else {
    throw error;
  }
}

const hooks = lock.createSessionLockHooks({ nowMs: 3000 });
const hookProject = project();
hooks['tui.prompt.append']({ cwd: hookProject, session_id: 'hook-session', text: '/bugfix-light corrigir login' }, {});
assert.equal(readJson(path.join(hookProject, '.pipeline', 'sessions', 'hook-session.lock')).session_id, 'hook-session');

const eventProject = project();
hooks.event({ cwd: eventProject, event: { type: 'tui.prompt.append', properties: { session_id: 'event-session', text: '/audit-heavy revisar auth' } } }, {});
assert.equal(readJson(path.join(eventProject, '.pipeline', 'sessions', 'event-session.lock')).session_id, 'event-session');

const pluginProject = project();
const pluginHooks = plugin.createPipelineAdaptationHooks({ directory: pluginProject }, { nowMs: 4000 });
pluginHooks['tui.prompt.append']({ session_id: 'plugin-session', text: '/spec-light criar ticket' }, {});
assert.equal(readJson(path.join(pluginProject, '.pipeline', 'sessions', 'plugin-session.lock')).session_id, 'plugin-session');

const orderProject = project();
const orderOutput = {};
const orderHooks = plugin.createPipelineAdaptationHooks({ directory: orderProject }, { nowMs: 5000 });
orderHooks['tui.prompt.append']({ session_id: 'order-session', text: '/feature-light criar painel' }, orderOutput);
assert.equal(readJson(path.join(orderProject, '.pipeline', 'sessions', 'order-session.lock')).session_id, 'order-session');
assert.match(orderOutput.systemMessage || '', /FASES OBRIGATORIAS/);

assert.equal(typeof opencodeIndex.createSessionLockHooks, 'function');

console.log('session lock hook OK');
