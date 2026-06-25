'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { sealSpecRun, REQUIRED_IMPL_GATES } = require('../../src/lib/run-seal.cjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function makeRun() {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-run-seal-'));
  const runId = path.basename(runDir);
  writeJson(path.join(runDir, 'manifest.yaml'), {
    run_id: runId,
    status: 'running',
    phase: 2,
    step_completed: 8,
    type: 'Spec',
    notes: {
      options: {
        spec_review_done: true,
      },
    },
  });
  writeJson(path.join(runDir, 'sentinel-state.json'), {
    schemaVersion: 'SENTINEL_STATE/v1',
    runId,
    currentPhase: 'phase_2',
    checkpoints: {},
    blocked: false,
    stopRuleTriggered: false,
    lastValidEventId: null,
    updatedAt: '2026-06-24T00:00:00.000Z',
    pipeline_active: true,
    spec_review_converged: true,
    notes: {
      options: {
        spec_review_done: true,
      },
    },
  });
  const specDir = path.join(runDir, '01-spec');
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, 'requirements.md'), 'requirements');
  fs.writeFileSync(path.join(specDir, 'design.md'), 'design');
  fs.writeFileSync(path.join(specDir, 'tasks.md'), 'tasks');
  fs.writeFileSync(path.join(specDir, 'research.md'), 'research');
  fs.writeFileSync(path.join(specDir, 'spec.json'), '{"ok":true}');
  return { runDir, allowedRoot: path.dirname(runDir) };
}

assert.deepEqual(REQUIRED_IMPL_GATES, [
  'TDD_APPROVAL',
  'ADVERSARIAL_BLOCK',
  'ADVERSARIAL_LOOP_CHECKPOINT',
]);
assert.equal(Object.isFrozen(REQUIRED_IMPL_GATES), true);

assert.equal(sealSpecRun('relative-run').ok, false);
assert.equal(sealSpecRun(path.resolve(os.tmpdir(), 'outside')).ok, false);

{
  const { runDir } = makeRun();
  const result = sealSpecRun(runDir, { allowedRoot: path.join(runDir, 'nested') });
  assert.equal(result.ok, false);
  assert.match(result.error, /allowedRoot/);
}

{
  const { runDir, allowedRoot } = makeRun();
  fs.rmSync(path.join(runDir, 'manifest.yaml'));
  const result = sealSpecRun(runDir, { allowedRoot });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['manifest.yaml']);
}

{
  const { runDir, allowedRoot } = makeRun();
  const manifestPath = path.join(runDir, 'manifest.yaml');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.type = 'Feature';
  writeJson(manifestPath, manifest);
  const result = sealSpecRun(runDir, { allowedRoot });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['type']);
}

{
  const { runDir, allowedRoot } = makeRun();
  const manifestPath = path.join(runDir, 'manifest.yaml');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  delete manifest.notes.options;
  writeJson(manifestPath, manifest);
  const result = sealSpecRun(runDir, { allowedRoot });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['notes.options']);
}

{
  const { runDir, allowedRoot } = makeRun();
  const manifestPath = path.join(runDir, 'manifest.yaml');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.notes.options.spec_review_done = false;
  writeJson(manifestPath, manifest);
  const result = sealSpecRun(runDir, { allowedRoot });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['spec_review_done']);
}

{
  const { runDir, allowedRoot } = makeRun();
  fs.rmSync(path.join(runDir, '01-spec', 'research.md'));
  const result = sealSpecRun(runDir, { allowedRoot, variant: 'spec-authoring' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['research.md']);
  assert.equal(fs.existsSync(path.join(runDir, 'gate-decisions.jsonl')), false);
}

{
  const { runDir, allowedRoot } = makeRun();
  fs.writeFileSync(path.join(runDir, '01-spec', 'spec.json'), '{bad json');
  const result = sealSpecRun(runDir, { allowedRoot, variant: 'spec-authoring' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['spec.json']);
}

{
  const { runDir, allowedRoot } = makeRun();
  fs.rmSync(path.join(runDir, 'sentinel-state.json'));
  const result = sealSpecRun(runDir, { allowedRoot });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['sentinel-state.json']);
}

{
  const { runDir, allowedRoot } = makeRun();
  const sentinelPath = path.join(runDir, 'sentinel-state.json');
  const sentinel = JSON.parse(fs.readFileSync(sentinelPath, 'utf8'));
  sentinel.spec_review_converged = false;
  writeJson(sentinelPath, sentinel);
  const result = sealSpecRun(runDir, { allowedRoot });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['spec_review_converged']);
}

{
  const { runDir, allowedRoot } = makeRun();
  const sentinelPath = path.join(runDir, 'sentinel-state.json');
  const sentinel = JSON.parse(fs.readFileSync(sentinelPath, 'utf8'));
  sentinel.notes.options.spec_review_done = false;
  writeJson(sentinelPath, sentinel);
  const result = sealSpecRun(runDir, { allowedRoot });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['spec_review_done']);
}

{
  const { runDir, allowedRoot } = makeRun();
  const manifestPath = path.join(runDir, 'manifest.yaml');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.notes.options.spec_sealed = true;
  writeJson(manifestPath, manifest);
  fs.rmSync(path.join(runDir, 'sentinel-state.json'));
  fs.writeFileSync(path.join(runDir, 'gate-decisions.jsonl'), JSON.stringify({ gate: 'SPEC_SEALED' }) + '\n');
  const result = sealSpecRun(runDir, { allowedRoot });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['sentinel-state.json']);
}

{
  const { runDir, allowedRoot } = makeRun();
  const result = sealSpecRun(runDir, {
    allowedRoot,
    variant: 'spec-authoring',
    grade: 'A\nB',
  });
  assert.deepEqual(result, { ok: true, sealed: true, runDir });

  const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.yaml'), 'utf8'));
  assert.equal(manifest.status, 'sealed');
  assert.equal(manifest.phase, 3);
  assert.equal(manifest.step_completed, 9);
  assert.equal(manifest.spec_lifecycle_completed, true);
  assert.equal(manifest.notes.options.spec_sealed, true);

  const sentinel = JSON.parse(fs.readFileSync(path.join(runDir, 'sentinel-state.json'), 'utf8'));
  assert.equal(sentinel.currentPhase, 'closed');
  assert.equal(sentinel.pipeline_active, false);
  assert.equal(sentinel.type, 'Spec');
  assert.equal(sentinel.pipeline_variant, 'spec-authoring');
  assert.equal(sentinel.final_decision, 'SEALED');
  for (const checkpointName of ['post_orchestrator', 'phase_0_to_1', 'phase_1_to_2', 'phase_2_to_3', 'post_final_validator']) {
    assert.equal(sentinel.checkpoints[checkpointName].status, 'PASS');
  }
  assert.deepEqual(sentinel.implementation_contract.required_impl_gates, REQUIRED_IMPL_GATES);

  const gateLines = fs.readFileSync(path.join(runDir, 'gate-decisions.jsonl'), 'utf8').trim().split(/\r?\n/);
  assert.equal(gateLines.length, 1);
  const gate = JSON.parse(gateLines[0]);
  assert.equal(gate.gate, 'SPEC_SEALED');
  assert.equal(gate.decision, 'CONFIRMED');
  assert.match(gate.detail, /grade=A B/);
  assert.doesNotMatch(gate.detail, /\n/);

  const manifestBeforeSecond = fs.readFileSync(path.join(runDir, 'manifest.yaml'), 'utf8');
  const sentinelBeforeSecond = fs.readFileSync(path.join(runDir, 'sentinel-state.json'), 'utf8');
  const second = sealSpecRun(runDir, { allowedRoot, variant: 'spec-authoring' });
  assert.equal(second.ok, true);
  const afterSecond = fs.readFileSync(path.join(runDir, 'gate-decisions.jsonl'), 'utf8').trim().split(/\r?\n/);
  assert.equal(afterSecond.length, 1);
  assert.equal(fs.readFileSync(path.join(runDir, 'manifest.yaml'), 'utf8'), manifestBeforeSecond);
  assert.equal(fs.readFileSync(path.join(runDir, 'sentinel-state.json'), 'utf8'), sentinelBeforeSecond);
}

console.log('run seal OK');
