'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CORRUPT_SENTINEL,
  discoverStatePath,
  findActiveSentinelState,
  findLivePendingBlock,
  findPairingEntry,
  getActiveExecWindow,
  getActiveLock,
  isExemptPath,
  resolveHandshakeTimeoutMs,
} = require('../../src/state/sentinel-state-inspector.cjs');
const stateIndex = require('../../src/state/index.cjs');

assert.equal(stateIndex.CORRUPT_SENTINEL, CORRUPT_SENTINEL);
assert.equal(typeof stateIndex.findActiveSentinelState, 'function');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function validSentinel(runId, extra = {}) {
  return {
    schemaVersion: 'SENTINEL_STATE/v1',
    runId,
    currentPhase: 'phase_0_to_1',
    checkpoints: {},
    blocked: false,
    stopRuleTriggered: false,
    lastValidEventId: null,
    updatedAt: '2026-06-21T00:00:00.000Z',
    ...extra,
  };
}

const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-open-code-inspector-'));
const docsRunDir = path.join(projectDir, '.pipeline', 'docs', 'Pre-feature-action', 'run-a');
writeJson(path.join(docsRunDir, 'sentinel-state.json'), validSentinel('run-a'));
fs.utimesSync(path.join(docsRunDir, 'sentinel-state.json'), new Date('2026-06-20T23:58:00.000Z'), new Date('2026-06-20T23:58:00.000Z'));

process.env.PIPELINE_DOC_PATH = docsRunDir;
let discovered = discoverStatePath(projectDir);
assert.equal(discovered.authoritative, true);
assert.equal(discovered.statePath, path.join(docsRunDir, 'sentinel-state.json'));
assert.equal(findActiveSentinelState(projectDir).runId, 'run-a');

process.env.PIPELINE_DOC_PATH = path.join(os.tmpdir(), 'outside-pipeline-doc');
const pointerDir = path.join(projectDir, '.pipeline', 'docs', 'Pre-feature-action', 'run-b');
writeJson(path.join(pointerDir, 'sentinel-state.json'), validSentinel('run-b'));
fs.utimesSync(path.join(pointerDir, 'sentinel-state.json'), new Date('2026-06-20T23:59:00.000Z'), new Date('2026-06-20T23:59:00.000Z'));
writeJson(path.join(projectDir, '.pipeline', 'active-run.json'), { pipeline_doc_path: pointerDir });
discovered = discoverStatePath(projectDir);
assert.equal(discovered.authoritative, true);
assert.equal(discovered.statePath, path.join(pointerDir, 'sentinel-state.json'));
assert.equal(findActiveSentinelState(projectDir).runId, 'run-b');

delete process.env.PIPELINE_DOC_PATH;
fs.rmSync(path.join(projectDir, '.pipeline', 'active-run.json'));
process.env.PIPELINE_RUN_ID = 'run-c';
const runIdDir = path.join(projectDir, '.pipeline', 'docs', 'Pre-feature-action', 'run-c');
writeJson(path.join(runIdDir, 'sentinel-state.json'), validSentinel('run-c'));
fs.utimesSync(path.join(runIdDir, 'sentinel-state.json'), new Date('2026-06-21T00:00:00.000Z'), new Date('2026-06-21T00:00:00.000Z'));
discovered = discoverStatePath(projectDir);
assert.equal(discovered.authoritative, true);
assert.equal(discovered.statePath, path.join(runIdDir, 'sentinel-state.json'));

delete process.env.PIPELINE_RUN_ID;
const fallbackDir = path.join(projectDir, '.pipeline', 'docs', 'Pre-feature-action', 'run-d');
writeJson(path.join(fallbackDir, 'sentinel-state.json'), validSentinel('run-d'));
fs.utimesSync(path.join(fallbackDir, 'sentinel-state.json'), new Date('2026-06-21T00:01:00.000Z'), new Date('2026-06-21T00:01:00.000Z'));
discovered = discoverStatePath(projectDir);
assert.equal(discovered.authoritative, false);
assert.equal(path.basename(path.dirname(discovered.statePath)), 'run-d');

process.env.PIPELINE_DOC_PATH = docsRunDir;
fs.writeFileSync(path.join(docsRunDir, 'sentinel-state.json'), '{bad json');
assert.equal(findActiveSentinelState(projectDir), CORRUPT_SENTINEL);

writeJson(path.join(docsRunDir, 'sentinel-state.json'), { schemaVersion: 'SENTINEL_STATE/v1', runId: 'bad' });
assert.equal(findActiveSentinelState(projectDir), CORRUPT_SENTINEL);

delete process.env.PIPELINE_DOC_PATH;
for (const blockType of ['DISPATCH_REQUEST', 'GATE_REQUEST', 'PLAN_MODE_REQUEST']) {
  const pending = findLivePendingBlock({
    pending_blocks: [
      { block_type: blockType, emitted_at: new Date(Date.now() - 1000).toISOString() },
    ],
  }, 60_000);
  assert.equal(pending.block_type, blockType);
}

const expired = findLivePendingBlock({
  pending_blocks: [
    { block_type: 'GATE_REQUEST', emitted_at: new Date(Date.now() - 120_000).toISOString() },
  ],
}, 60_000);
assert.equal(expired, null);

assert.equal(isExemptPath(path.join(projectDir, '.pipeline', 'notes.md'), projectDir), true);
assert.equal(isExemptPath(path.join(projectDir, 'pipeline-runs', '001', 'TRACE.md'), projectDir), true);
process.env.OPENCODE_CONFIG_DIR = path.join(projectDir, '.opencode');
assert.equal(isExemptPath(path.join(process.env.OPENCODE_CONFIG_DIR, 'plans', 'w0.md'), projectDir), true);
delete process.env.OPENCODE_CONFIG_DIR;
assert.equal(isExemptPath(path.join(projectDir, 'src', 'state', 'x.cjs'), projectDir), false);

const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-open-code-outside-'));
const escapedPipelineDir = path.join(projectDir, '.pipeline', 'escaped');
fs.symlinkSync(outsideDir, escapedPipelineDir, process.platform === 'win32' ? 'junction' : 'dir');
assert.equal(isExemptPath(path.join(escapedPipelineDir, 'secret.txt'), projectDir), false);

const fallbackProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-open-code-fallback-'));
const olderValidDir = path.join(fallbackProject, '.pipeline', 'docs', 'Pre-feature-action', 'older-valid');
const newerCorruptDir = path.join(fallbackProject, '.pipeline', 'docs', 'Pre-feature-action', 'newer-corrupt');
writeJson(path.join(olderValidDir, 'sentinel-state.json'), validSentinel('older-valid'));
fs.mkdirSync(newerCorruptDir, { recursive: true });
fs.writeFileSync(path.join(newerCorruptDir, 'sentinel-state.json'), '{bad json');
fs.utimesSync(path.join(olderValidDir, 'sentinel-state.json'), new Date('2026-06-21T00:00:00.000Z'), new Date('2026-06-21T00:00:00.000Z'));
fs.utimesSync(path.join(newerCorruptDir, 'sentinel-state.json'), new Date('2026-06-21T00:01:00.000Z'), new Date('2026-06-21T00:01:00.000Z'));
assert.equal(findActiveSentinelState(fallbackProject), CORRUPT_SENTINEL);
writeJson(path.join(newerCorruptDir, 'sentinel-state.json'), validSentinel('newer-valid'));
fs.utimesSync(path.join(newerCorruptDir, 'sentinel-state.json'), new Date('2026-06-21T00:01:00.000Z'), new Date('2026-06-21T00:01:00.000Z'));
assert.equal(findActiveSentinelState(fallbackProject).runId, 'newer-valid');

const linkedStateProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-open-code-linked-state-'));
const linkedStateRunDir = path.join(linkedStateProject, '.pipeline', 'docs', 'Pre-feature-action', 'linked-state');
const outsideStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-open-code-state-outside-'));
const outsideStatePath = path.join(outsideStateDir, 'sentinel-state.json');
fs.mkdirSync(linkedStateRunDir, { recursive: true });
writeJson(outsideStatePath, validSentinel('outside-state'));
fs.symlinkSync(outsideStatePath, path.join(linkedStateRunDir, 'sentinel-state.json'), 'file');
process.env.PIPELINE_DOC_PATH = linkedStateRunDir;
assert.equal(findActiveSentinelState(linkedStateProject), CORRUPT_SENTINEL);
delete process.env.PIPELINE_DOC_PATH;

const externalSessions = fs.mkdtempSync(path.join(os.tmpdir(), 'po-open-code-sessions-'));
const sessionsBypassProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-open-code-sessions-project-'));
fs.mkdirSync(path.join(sessionsBypassProject, '.pipeline'), { recursive: true });
writeJson(path.join(externalSessions, 'active.lock'), {
  session_id: 'escaped-session',
  status: 'active',
  created_at: Date.now(),
  last_seen_at: Date.now(),
  expires_at: Date.now() + 60_000,
});
fs.symlinkSync(externalSessions, path.join(sessionsBypassProject, '.pipeline', 'sessions'), process.platform === 'win32' ? 'junction' : 'dir');
assert.equal(getActiveLock(sessionsBypassProject), null);

const execBypassProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-open-code-exec-project-'));
const externalExecSessions = fs.mkdtempSync(path.join(os.tmpdir(), 'po-open-code-exec-sessions-'));
fs.mkdirSync(path.join(execBypassProject, '.pipeline'), { recursive: true });
fs.symlinkSync(externalExecSessions, path.join(execBypassProject, '.pipeline', 'sessions'), process.platform === 'win32' ? 'junction' : 'dir');
writeJson(path.join(externalExecSessions, 'active.exec-window'), { session_id: 'escaped-session', ttl_minutes: 5 });
const openedAt = fs.statSync(path.join(externalExecSessions, 'active.exec-window')).mtimeMs;
fs.mkdirSync(path.join(execBypassProject, '.pipeline', 'docs', 'Pre-feature-action', 'run'), { recursive: true });
fs.writeFileSync(
  path.join(execBypassProject, '.pipeline', 'docs', 'Pre-feature-action', 'run', 'gate-decisions.jsonl'),
  `${JSON.stringify({ gate: 'EXEC_WINDOW_OPEN', session_id: 'escaped-session', timestamp: openedAt })}\n`
);
assert.equal(getActiveExecWindow(execBypassProject, 'escaped-session'), null);

const externalDocs = fs.mkdtempSync(path.join(os.tmpdir(), 'po-open-code-docs-'));
const docsBypassProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-open-code-docs-project-'));
fs.mkdirSync(path.join(docsBypassProject, '.pipeline'), { recursive: true });
fs.mkdirSync(path.join(externalDocs, 'Pre-feature-action', 'run'), { recursive: true });
fs.writeFileSync(
  path.join(externalDocs, 'Pre-feature-action', 'run', 'gate-decisions.jsonl'),
  `${JSON.stringify({ gate: 'EXEC_WINDOW_OPEN', session_id: 'escaped-session', timestamp: openedAt })}\n`
);
fs.symlinkSync(externalDocs, path.join(docsBypassProject, '.pipeline', 'docs'), process.platform === 'win32' ? 'junction' : 'dir');
assert.equal(findPairingEntry(docsBypassProject, 'escaped-session', openedAt), null);

process.env.OPENCODE_CONFIG_DIR = path.join(os.tmpdir(), 'unsafe-config-dir');
assert.equal(isExemptPath(path.join(process.env.OPENCODE_CONFIG_DIR, 'plans', 'not-a-plan.md'), projectDir), false);
delete process.env.OPENCODE_CONFIG_DIR;

process.env.PIPELINE_HANDSHAKE_TIMEOUT_MS = '1';
assert.equal(resolveHandshakeTimeoutMs(), 60_000);
process.env.PIPELINE_HANDSHAKE_TIMEOUT_MS = String(5 * 60 * 60 * 1000);
assert.equal(resolveHandshakeTimeoutMs(), 4 * 60 * 60 * 1000);
delete process.env.PIPELINE_HANDSHAKE_TIMEOUT_MS;

console.log('sentinel state inspector OK');
