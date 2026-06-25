'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { compareCanonicalRunDirs } = require('../../src/verification/e2e-parity.cjs');

const stateRoot = fs.mkdtempSync(path.join(process.cwd(), 'tmp', 'po-w11-2-canonical-'));

function decision(runId, gate, phase) {
  return {
    schemaVersion: 'GATE_DECISION_RECORD/v1',
    runId,
    gate,
    hardness: 'SOFT',
    phase,
    decision: 'APPROVED',
    decided_by: 'test',
    timestamp: '2026-06-25T00:00:00.000Z',
    detail: `${gate} ${phase}`,
    confidence_impact: 0,
  };
}

function event(runId, eventId, parentEventId = null) {
  return {
    schemaVersion: 'PROTOCOL_EVENT_RECORD/v1',
    runId,
    eventId,
    eventType: 'TEST_EVENT',
    phase: 'sprint-7',
    timestamp: '2026-06-25T00:00:00.000Z',
    actor: 'test',
    payloadRef: 'payload.json',
    parentEventId,
    severity: 'info',
  };
}

function evidence(runId, evidenceId, evidenceType) {
  const artifactRef = path.join('runs', runId, `${evidenceId}.log`);
  return {
    schemaVersion: 'EVIDENCE_RECORD/v1',
    runId,
    evidenceId,
    evidenceType,
    mode: 'bugfix-light',
    sprint: '7',
    slice: 'w11-2',
    commandOrPromptRef: 'test fixture',
    resultSummary: `${evidenceType} recorded`,
    artifactRef,
    verdict: 'PASS',
    createdAt: '2026-06-25T00:00:00.000Z',
  };
}

function writeJsonl(filePath, records) {
  fs.writeFileSync(filePath, records.map((record) => JSON.stringify(record)).join('\n') + '\n');
}

function writeRun(runId, gates) {
  const runDir = path.join(stateRoot, 'runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  writeJsonl(path.join(runDir, 'gate-decisions.jsonl'), gates.map(([gate, phase]) => decision(runId, gate, phase)));
  writeJsonl(path.join(runDir, 'protocol-events.jsonl'), [event(runId, `${runId}-event-1`)]);
  const evidenceRecords = [evidence(runId, `${runId}-acceptance`, 'ACCEPTANCE')];
  for (const record of evidenceRecords) fs.writeFileSync(path.join(stateRoot, record.artifactRef), 'evidence\n');
  writeJsonl(path.join(runDir, 'evidence.jsonl'), evidenceRecords);
  return runDir;
}

const canonicalRunDir = writeRun('canonical', [
  ['RED_REPRODUCTION', 'sprint-7'],
  ['RED_REPRODUCTION', 'sprint-7'],
  ['TDD_APPROVAL', 'sprint-7'],
  ['GREEN_REGRESSION', 'sprint-7'],
  ['CLOSEOUT_CONFIRM', 'sprint-7'],
]);

const matchingRunDir = writeRun('opencode-match', [
  ['RED_REPRODUCTION', 'sprint-7'],
  ['RED_REPRODUCTION', 'sprint-7'],
  ['TDD_APPROVAL', 'sprint-7'],
  ['GREEN_REGRESSION', 'sprint-7'],
  ['CLOSEOUT_CONFIRM', 'sprint-7'],
]);

const matching = compareCanonicalRunDirs(matchingRunDir, canonicalRunDir, { allowedRoot: stateRoot, threshold: 0.9 });
assert.equal(matching.ok, true, JSON.stringify(matching, null, 2));
assert.equal(matching.comparison.matchRatio, 1);
assert.deepEqual(matching.comparison.missing, []);
assert.deepEqual(matching.comparison.extra, []);

const divergentRunDir = writeRun('opencode-divergent', [
  ['RED_REPRODUCTION', 'sprint-7'],
  ['TDD_APPROVAL', 'sprint-7'],
  ['GREEN_REGRESSION', 'sprint-7'],
  ['OPEN_CODE_ONLY_GATE', 'sprint-7'],
]);

const divergent = compareCanonicalRunDirs(divergentRunDir, canonicalRunDir, { allowedRoot: stateRoot, threshold: 0.9 });
assert.equal(divergent.ok, false);
assert.equal(divergent.comparison.matchRatio, 0.6);
assert.deepEqual(divergent.comparison.missing, ['RED_REPRODUCTION@sprint-7', 'CLOSEOUT_CONFIRM@sprint-7']);
assert.deepEqual(divergent.comparison.extra, ['OPEN_CODE_ONLY_GATE@sprint-7']);

const missingCanonicalRunDir = path.join(stateRoot, 'runs', 'missing-canonical');
fs.mkdirSync(missingCanonicalRunDir, { recursive: true });
const missingCanonical = compareCanonicalRunDirs(matchingRunDir, missingCanonicalRunDir, { allowedRoot: stateRoot, threshold: 0.9 });
assert.equal(missingCanonical.ok, false);
assert.equal(missingCanonical.canonical.validation.errors.includes('missing gate-decisions.jsonl'), true);

console.log('w11.2 canonical comparison preparation OK');
