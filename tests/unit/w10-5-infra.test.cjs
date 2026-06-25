'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { safeAppendJsonl, sanitizeDetail, sanitizeEntry, DETAIL_MAX_LEN } = require('../../src/lib/jsonl-sanitizer.cjs');
const { appendRunLog, readRunLog, runLogPath, REQUIRED_FIELDS } = require('../../src/lib/run-log.cjs');
const { RunManifest, notesToObject } = require('../../src/lib/run-manifest.cjs');
const { appendGateDecision, buildCtx, CANONICAL_DECISIONS, CANONICAL_HARDNESS, SCHEMA_VERSION } = require('../../src/lib/gate-decision-writer.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w10-5-'));

assert.equal(sanitizeDetail(`a\n\t${'x'.repeat(250)}`).length, DETAIL_MAX_LEN);
const sanitized = sanitizeEntry({ gate: 'G', detail: 'hello\nworld', extra: 'drop' });
assert.deepEqual(sanitized, { gate: 'G', detail: 'hello world' });

const gatePath = path.join(tmp, 'gate-decisions.jsonl');
const append = safeAppendJsonl(gatePath, {
  run_id: 'run_1', plugin_version: 'local', schema_version: '1', type: 'Feature', complexity: 'SIMPLES',
  gate: 'TEST_GATE', hardness: 'HARD', phase: '1', decision: 'APPROVED', decided_by: 'test',
  timestamp: '2026-06-25T00:00:00.000Z', detail: 'ok\nforged', confidence_impact: 0, extra: 'drop',
});
assert.equal(append.ok, true);
assert.deepEqual(append.unknownKeysDropped, ['extra']);
assert.equal(JSON.parse(fs.readFileSync(gatePath, 'utf8')).detail, 'ok forged');

const ctx = buildCtx(path.join(tmp, 'pipeline-runs', '001-demo'), { type: 'Feature', complexity: 'MEDIA' });
assert.equal(ctx.run_id, '001-demo');
assert.equal(ctx.schema_version, SCHEMA_VERSION);
const decision = appendGateDecision(gatePath, {
  gate: 'STEP_1_7_ROUTING', hardness: 'HARD', phase: '1.7', decision: 'CONFIRMED', decided_by: 'test',
  timestamp: '2026-06-25T00:00:00.000Z', detail: 'confirmed', confidence_impact: 0,
}, ctx);
assert.equal(decision.ok, true);
assert.throws(() => appendGateDecision(gatePath, { hardness: 'HARD', decision: 'PASS' }, ctx), /CANONICAL_DECISIONS/);
assert.equal(CANONICAL_DECISIONS.has('CONFIRMED'), true);
assert.equal(CANONICAL_HARDNESS.has('HARD'), true);

const runLogEntry = {
  run_id: 'run\n1', timestamp_start: '2026-06-25T00:00:00.000Z', timestamp_end: '2026-06-25T00:00:10.000Z',
  type: 'Feature', complexity: 'MEDIA', variant: 'feature-light', total_gates_triggered: '2', total_gates_expected: '3',
  fidelity_score: '0.5', duration_seconds: '10', final_decision: 'GO\nforged', pipeline_doc_path: path.join(tmp, 'pipeline-runs', '001-demo'),
};
assert.equal(appendRunLog(tmp, runLogEntry).ok, true);
assert.equal(runLogPath(tmp), path.join(tmp, '.pipeline', 'run-log.jsonl'));
const runLog = readRunLog(tmp);
assert.equal(runLog.length, 1);
assert.equal(runLog[0].run_id, 'run 1');
assert.equal(runLog[0].total_gates_triggered, 2);
assert.equal(runLog[0].final_decision, 'GO forged');
assert.equal(REQUIRED_FIELDS.length, 12);

const manifestObject = {
  schema_version: 1,
  run_id: '001-demo',
  created_at: '2026-06-25T00:00:00.000Z',
  updated_at: '2026-06-25T00:00:00.000Z',
  status: 'sealed',
  phase: 3,
  step_completed: null,
  type: 'Spec',
  complexity: 'unknown',
  brainstorm_completed: true,
  spec_lifecycle_completed: true,
  handoff_decision: null,
  linked_pipeline_doc_path: null,
  notes: { prompt: 'safe' },
};
const manifest = RunManifest.fromObject(manifestObject);
const roundTrip = RunManifest.fromYaml(manifest.toYaml());
assert.deepEqual(roundTrip.toObject(), { ...manifestObject, notes: JSON.stringify(manifestObject.notes) });
assert.deepEqual(roundTrip.notesObject(), { prompt: 'safe' });
assert.deepEqual(notesToObject('{"a":1}'), { a: 1 });
assert.deepEqual(notesToObject('[1]'), {});
assert.throws(() => RunManifest.fromObject({ ...manifestObject, status: 'done' }), /invalid status/);

console.log('w10.5 infra OK');
