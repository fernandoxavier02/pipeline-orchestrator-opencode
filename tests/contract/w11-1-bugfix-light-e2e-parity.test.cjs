'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { startRun } = require('../../src/state/run-store.cjs');
const { runModeQualitySprint } = require('../../src/opencode/mode-quality.cjs');
const { verifyE2EParityRun } = require('../../src/verification/e2e-parity.cjs');

function writeArtifact(run, name, content) {
  const filePath = path.join(run.stateRoot, 'runs', run.runId, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

const stateRoot = fs.mkdtempSync(path.join(process.cwd(), 'tmp', 'po-w11-1-bugfix-light-'));
const run = startRun({
  stateRoot,
  prompt: 'W11.1 bugfix-light E2E parity fixture',
  batchId: 'batch-w11-1',
  sliceId: 'slice-w11-1',
  observableOutcome: 'bugfix-light artifacts produced',
  allowedSurfaces: ['src/**', 'tests/**', 'tmp/**'],
});
const runContext = { stateRoot, runId: run.runId };

const input = {
  reproduction: { command: 'node repro-login-error.cjs fixture-input', artifactRef: writeArtifact(runContext, 'repro.log', 'TypeError: login failed'), summary: 'Reproduced login TypeError.' },
  red: { command: 'node login-red.test.cjs', artifactRef: writeArtifact(runContext, 'red.log', 'FAIL expected TypeError: login failed'), expectedFailurePattern: 'TypeError: login failed', observedFailure: 'FAIL expected TypeError: login failed' },
  fix: { command: 'apply minimal guard', artifactRef: writeArtifact(runContext, 'fix.log', 'changed one guard'), changedFiles: ['src/opencode/login.cjs'], summary: 'Minimal guard only.' },
  green: { command: 'node login-red.test.cjs', artifactRef: writeArtifact(runContext, 'green.log', 'PASS login regression'), summary: 'Focused test passes.' },
  regression: { command: 'node regression-login.cjs', artifactRef: writeArtifact(runContext, 'regression.log', 'PASS regression'), summary: 'Core login regression passes.' },
  closeout: { command: 'closeout checklist', artifactRef: writeArtifact(runContext, 'closeout.log', 'closed with evidence'), summary: 'Closeout recorded.' },
};

const result = runModeQualitySprint({ stateRoot, runId: run.runId, sprint: '7', mode: 'bugfix-light', input });
assert.equal(result.ok, true);

const runDir = path.join(stateRoot, 'runs', run.runId);
const reference = {
  source: 'OpenCode W11.1 minimal bugfix-light reference; W11.2 must replace/compare with canonical Claude Code output.',
  expectedGatePhases: [
    { gate: 'RED_REPRODUCTION', phase: 'sprint-7' },
    { gate: 'RED_REPRODUCTION', phase: 'sprint-7' },
    { gate: 'TDD_APPROVAL', phase: 'sprint-7' },
    { gate: 'GREEN_REGRESSION', phase: 'sprint-7' },
    { gate: 'CLOSEOUT_CONFIRM', phase: 'sprint-7' },
  ],
};

const verification = verifyE2EParityRun(runDir, reference);
assert.equal(verification.ok, true, JSON.stringify({ validation: verification.validation, parity: verification.parity }, null, 2));
assert.equal(verification.artifacts.missing.length, 0);
assert.equal(verification.artifacts.decisions.length, 5);
assert.equal(verification.artifacts.events.length, 6);
assert.equal(verification.artifacts.evidence.length, 6);
assert.equal(verification.parity.matchRatio, 1);

const missingGate = verifyE2EParityRun(runDir, {
  expectedGatePhases: [...reference.expectedGatePhases, { gate: 'CANONICAL_ONLY_GATE', phase: 'sprint-7' }],
});
assert.equal(missingGate.ok, false);
assert.deepEqual(missingGate.parity.missing, ['CANONICAL_ONLY_GATE@sprint-7']);

const extraGateAllowed = verifyE2EParityRun(runDir, {
  expectedGatePhases: reference.expectedGatePhases.slice(0, -1),
  failOnExtra: false,
});
assert.equal(extraGateAllowed.ok, true);

const extraGateBlocked = verifyE2EParityRun(runDir, {
  expectedGatePhases: reference.expectedGatePhases.slice(0, -1),
});
assert.equal(extraGateBlocked.ok, false);
assert.equal(extraGateBlocked.parity.extra.includes('CLOSEOUT_CONFIRM@sprint-7'), true);

const malformedRunDir = path.join(stateRoot, 'runs', 'malformed-jsonl');
fs.mkdirSync(malformedRunDir, { recursive: true });
fs.writeFileSync(path.join(malformedRunDir, 'gate-decisions.jsonl'), '{bad json}\n');
fs.writeFileSync(path.join(malformedRunDir, 'protocol-events.jsonl'), '');
fs.writeFileSync(path.join(malformedRunDir, 'evidence.jsonl'), '');
const malformed = verifyE2EParityRun(malformedRunDir, { expectedGatePhases: [] });
assert.equal(malformed.ok, false);
assert.equal(malformed.validation.errors.some((error) => /malformed JSON/.test(error)), true);

const absoluteArtifactRunDir = path.join(stateRoot, 'runs', 'absolute-artifact-ref');
fs.mkdirSync(absoluteArtifactRunDir, { recursive: true });
fs.writeFileSync(path.join(absoluteArtifactRunDir, 'gate-decisions.jsonl'), '');
fs.writeFileSync(path.join(absoluteArtifactRunDir, 'protocol-events.jsonl'), '');
fs.writeFileSync(path.join(absoluteArtifactRunDir, 'evidence.jsonl'), JSON.stringify({
  schemaVersion: 'EVIDENCE_RECORD/v1',
  runId: 'absolute-artifact-ref',
  evidenceId: 'ev-absolute',
  evidenceType: 'RED',
  commandOrPromptRef: 'node red.test.cjs',
  resultSummary: 'absolute ref rejected',
  artifactRef: path.join(stateRoot, 'outside.log'),
  verdict: 'PASS',
  createdAt: new Date().toISOString(),
}) + '\n');
const absoluteArtifact = verifyE2EParityRun(absoluteArtifactRunDir, { expectedGatePhases: [] });
assert.equal(absoluteArtifact.ok, false);
assert.equal(absoluteArtifact.validation.errors.some((error) => /artifactRef must be relative/.test(error)), true);

assert.throws(() => verifyE2EParityRun(path.resolve(process.cwd(), '..', 'outside-run'), reference), /inside adaptation tmp/);

console.log('w11.1 bugfix-light e2e parity OK');
