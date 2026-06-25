'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  MANDATORY_GATES_BY_COMPLEXITY,
  SCHEMA_VERSION,
  generateFidelityReport,
  isAuthoringVariant,
  mandatorySetFor,
} = require('../../src/lib/fidelity-reporter.cjs');

assert.equal(SCHEMA_VERSION, '1.0.0');

assert.equal(isAuthoringVariant('spec-authoring'), true);
assert.equal(isAuthoringVariant(' spec-author '), true);
assert.equal(isAuthoringVariant('SPEC-AUTHORING'), true);
assert.equal(isAuthoringVariant('spec-authority-check'), false);
assert.equal(isAuthoringVariant('spec-light'), false);
assert.equal(isAuthoringVariant('spec'), false);
assert.equal(isAuthoringVariant(null), false);

const simples = mandatorySetFor('SIMPLES', 'Feature');
assert.equal(simples.length, 11);
assert.deepEqual(simples, MANDATORY_GATES_BY_COMPLEXITY.SIMPLES);
assert.notEqual(simples, MANDATORY_GATES_BY_COMPLEXITY.SIMPLES);
simples.push('LOCAL_MUTATION');
assert.equal(MANDATORY_GATES_BY_COMPLEXITY.SIMPLES.includes('LOCAL_MUTATION'), false);

const mediaSpec = mandatorySetFor('MEDIA', 'Spec', 'spec-light');
assert.equal(mediaSpec.length, 19);
assert.equal(mediaSpec.includes('STOP_RULE'), true);
assert.equal(mediaSpec.includes('SPEC_POST_IMPL_FAIL'), true);
assert.equal(mediaSpec.includes('SPEC_SEALED'), false);

const authoring = mandatorySetFor('COMPLEXA', 'Spec', 'spec-authoring');
assert.deepEqual(authoring, ['SPEC_SEALED', 'SPEC_REVIEW_FINDINGS']);

const historicalAuthoring = mandatorySetFor('SIMPLES', 'Feature', 'spec-author');
assert.deepEqual(historicalAuthoring, ['SPEC_SEALED', 'SPEC_REVIEW_FINDINGS']);

const nearMiss = mandatorySetFor('COMPLEXA', 'Spec', 'spec-authority-check');
assert.equal(nearMiss.length, 24);
assert.equal(nearMiss.includes('SPEC_SEALED'), false);
assert.equal(nearMiss.includes('SPEC_ARTIFACT_MISSING'), true);

assert.deepEqual(mandatorySetFor('UNKNOWN', 'Feature'), []);
assert.deepEqual(mandatorySetFor('UNKNOWN', 'Spec'), MANDATORY_GATES_BY_COMPLEXITY.SPEC);

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'po-fidelity-'));
const runDir = path.join(repoRoot, 'pipeline-runs', '001-test');
fs.mkdirSync(runDir, { recursive: true });
fs.writeFileSync(path.join(runDir, 'gate-decisions.jsonl'), [
  JSON.stringify({ gate: 'SPEC_SEALED', decision: 'PASS' }),
  JSON.stringify({ gate: 'SPEC_REVIEW_FINDINGS', decision: 'PASS' }),
].join('\n') + '\n');

const report = generateFidelityReport({
  repoRoot,
  pipelineDocPath: runDir,
  type: 'Spec',
  complexity: 'unknown',
  variant: 'spec-authoring',
  runId: 'run_1',
});
assert.equal(report.ok, true);
assert.equal(report.mandatoryExpected, 2);
assert.equal(report.mandatoryTriggered, 2);
assert.equal(report.fidelityScore, 1);
assert.equal(fs.existsSync(report.jsonPath), true);
assert.equal(fs.existsSync(report.mdPath), true);
const jsonReport = JSON.parse(fs.readFileSync(report.jsonPath, 'utf8'));
assert.equal(jsonReport.schema_version, SCHEMA_VERSION);
assert.equal(jsonReport.run_id, 'run_1');
assert.equal(jsonReport.mandatory_expected, 2);
assert.equal(jsonReport.mandatory_triggered, 2);
assert.equal(jsonReport.fidelity_score, 1);
assert.deepEqual(jsonReport.mandatory_gates.map((gate) => gate.gate), ['SPEC_SEALED', 'SPEC_REVIEW_FINDINGS']);
assert.equal(jsonReport.mandatory_gates.every((gate) => gate.expected === true && gate.triggered === true), true);
assert.equal(Array.isArray(jsonReport.other_gates), true);
assert.match(fs.readFileSync(report.mdPath, 'utf8'), /Mandatory Gates Coverage/);

assert.deepEqual(
  generateFidelityReport({ repoRoot: 'relative', pipelineDocPath: runDir, type: 'Spec', complexity: 'MEDIA' }),
  { ok: false, error: 'path-traversal: repoRoot must be absolute' }
);
assert.deepEqual(
  generateFidelityReport({ repoRoot, pipelineDocPath: path.join(os.tmpdir(), 'outside'), type: 'Spec', complexity: 'MEDIA' }),
  { ok: false, error: 'path-traversal: pipelineDocPath outside repoRoot' }
);

const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'po-fidelity-outside-'));
const linkPath = path.join(repoRoot, 'pipeline-runs', 'linked-outside');
try {
  fs.symlinkSync(outsideRoot, linkPath, 'junction');
  assert.deepEqual(
    generateFidelityReport({ repoRoot, pipelineDocPath: linkPath, type: 'Spec', complexity: 'MEDIA' }),
    { ok: false, error: 'path-traversal: pipelineDocPath outside repoRoot' }
  );
} catch (err) {
  if (!['EPERM', 'EACCES', 'ENOSYS'].includes(err.code)) throw err;
}

const symlinkRunDir = path.join(repoRoot, 'pipeline-runs', '002-symlink-file');
fs.mkdirSync(symlinkRunDir, { recursive: true });
const outsideFile = path.join(outsideRoot, 'outside-gates.jsonl');
fs.writeFileSync(outsideFile, JSON.stringify({ gate: 'SPEC_SEALED' }) + '\n');
try {
  fs.symlinkSync(outsideFile, path.join(symlinkRunDir, 'gate-decisions.jsonl'), 'file');
  const symlinkRead = generateFidelityReport({ repoRoot, pipelineDocPath: symlinkRunDir, type: 'Spec', complexity: 'MEDIA' });
  assert.equal(symlinkRead.ok, false);
  assert.match(symlinkRead.error, /path-traversal/);
} catch (err) {
  if (!['EPERM', 'EACCES', 'ENOSYS'].includes(err.code)) throw err;
}

const symlinkOutputDir = path.join(repoRoot, 'pipeline-runs', '003-symlink-output');
fs.mkdirSync(symlinkOutputDir, { recursive: true });
const outsideReport = path.join(outsideRoot, 'outside-report.json');
fs.writeFileSync(outsideReport, 'outside');
try {
  fs.symlinkSync(outsideReport, path.join(symlinkOutputDir, 'fidelity-report.json'), 'file');
  const symlinkWrite = generateFidelityReport({ repoRoot, pipelineDocPath: symlinkOutputDir, type: 'Feature', complexity: 'SIMPLES' });
  assert.equal(symlinkWrite.ok, false);
  assert.match(symlinkWrite.error, /path-traversal/);
  assert.equal(fs.readFileSync(outsideReport, 'utf8'), 'outside');
} catch (err) {
  if (!['EPERM', 'EACCES', 'ENOSYS'].includes(err.code)) throw err;
}

console.log('fidelity reporter OK');
