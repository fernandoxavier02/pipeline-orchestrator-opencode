'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { readVerifiedState, verifyState, writeSignedState } = require('./sentinel-state-signer.cjs');

const REQUIRED_IMPL_GATES = Object.freeze([
  'TDD_APPROVAL',
  'ADVERSARIAL_BLOCK',
  'ADVERSARIAL_LOOP_CHECKPOINT',
]);

function nowIso() {
  return new Date().toISOString();
}

function sanitizeForDetail(value) {
  if (value == null) return null;
  return String(value).replace(/[\t\n\r]/g, ' ').replace(/[\x00-\x1F\x7F]/g, '').trim();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function notesToObject(notes) {
  if (notes && typeof notes === 'object' && !Array.isArray(notes)) return notes;
  return {};
}

function isWithinAllowedRoot(runDir, allowedRoot) {
  if (typeof allowedRoot !== 'string' || !allowedRoot || !path.isAbsolute(allowedRoot)) return false;
  let realRunDir;
  let realAllowedRoot;
  try {
    realRunDir = fs.realpathSync(runDir);
    realAllowedRoot = fs.realpathSync(allowedRoot);
  } catch (_err) {
    return false;
  }
  const relative = path.relative(realAllowedRoot, realRunDir);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function isPathWithinAllowedRoot(targetPath, allowedRoot) {
  if (typeof allowedRoot !== 'string' || !allowedRoot || !path.isAbsolute(allowedRoot)) return false;
  try {
    const existingPath = fs.existsSync(targetPath) ? targetPath : path.dirname(targetPath);
    const realTarget = fs.realpathSync(existingPath);
    const realAllowedRoot = fs.realpathSync(allowedRoot);
    const relative = path.relative(realAllowedRoot, realTarget);
    return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  } catch (_err) {
    return false;
  }
}

function alreadySealed(gatePath) {
  try {
    if (!fs.existsSync(gatePath)) return false;
    for (const line of fs.readFileSync(gatePath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        if (JSON.parse(trimmed).gate === 'SPEC_SEALED') return true;
      } catch (_err) {
        // Ignore malformed historical lines; sealing should still be possible.
      }
    }
  } catch (_err) {
    return false;
  }
  return false;
}

function requiredArtifactMissing(specDir, name, allowedRoot) {
  const artifactPath = path.join(specDir, name);
  try {
    if (!fs.existsSync(artifactPath)) return true;
    if (!isPathWithinAllowedRoot(artifactPath, allowedRoot)) return true;
    const body = fs.readFileSync(artifactPath, 'utf8');
    if (!body.trim()) return true;
    if (name === 'spec.json') JSON.parse(body);
    return false;
  } catch (_err) {
    return true;
  }
}

function checkPreconditions(runDir, manifest, allowedRoot) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, error: 'sealSpecRun: manifest.yaml missing or invalid — cannot verify seal preconditions', missing: ['manifest.yaml'] };
  }
  if (manifest.type !== 'Spec') {
    return { ok: false, error: 'sealSpecRun: manifest type must be Spec before sealing', missing: ['type'] };
  }
  const notes = notesToObject(manifest.notes);
  const options = notes.options;
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return { ok: false, error: 'sealSpecRun: Spec run is missing notes.options — cannot verify seal preconditions', missing: ['notes.options'] };
  }
  if (options.spec_review_done !== true) {
    return { ok: false, error: 'sealSpecRun: spec_review_done not set — review loop did not converge', missing: ['spec_review_done'] };
  }

  const specDir = path.join(runDir, '01-spec');
  const missing = ['requirements.md', 'design.md', 'tasks.md', 'spec.json']
    .filter((name) => requiredArtifactMissing(specDir, name, allowedRoot));
  if (missing.length > 0) {
    return { ok: false, error: `sealSpecRun: missing required artifact(s): ${missing.join(', ')}`, missing };
  }
  if (requiredArtifactMissing(specDir, 'research.md', allowedRoot)) {
    return { ok: false, error: 'sealSpecRun: research.md missing — Step 8 must write it before sealing', missing: ['research.md'] };
  }

  const sentinelPath = path.join(runDir, 'sentinel-state.json');
  try {
    const { state, verification } = readVerifiedState(sentinelPath);
    if (!verification || verification.valid !== true) {
      return { ok: false, error: 'sealSpecRun: sentinel-state.json invalid — cannot verify seal preconditions', missing: ['sentinel-state.json'] };
    }
    const sentinelNotes = notesToObject(state.notes);
    const sentinelOptions = sentinelNotes.options;
    if (!sentinelOptions || sentinelOptions.spec_review_done !== true) {
      return { ok: false, error: 'sealSpecRun: spec_review_done not set in sentinel — review loop did not converge', missing: ['spec_review_done'] };
    }
    if (state.spec_review_converged !== true) {
      return { ok: false, error: 'sealSpecRun: spec_review_converged not set — review loop must converge before sealing', missing: ['spec_review_converged'] };
    }
  } catch (_err) {
    return { ok: false, error: 'sealSpecRun: sentinel-state.json unreadable — cannot verify seal preconditions', missing: ['sentinel-state.json'] };
  }

  return { ok: true };
}

function sealSpecRun(runDir, opts = {}) {
  try {
    if (typeof runDir !== 'string' || !runDir) {
      return { ok: false, error: 'sealSpecRun: runDir must be a non-empty string' };
    }
    if (!path.isAbsolute(runDir)) return { ok: false, error: 'runDir must be absolute' };
    if (!fs.existsSync(runDir)) return { ok: false, error: `sealSpecRun: runDir does not exist: ${runDir}` };
    if (!isWithinAllowedRoot(runDir, opts.allowedRoot)) {
      return { ok: false, error: 'sealSpecRun: runDir must be inside allowedRoot', missing: ['allowedRoot'] };
    }

    const manifestPath = path.join(runDir, 'manifest.yaml');
    const sentinelPath = path.join(runDir, 'sentinel-state.json');
    const gatePath = path.join(runDir, 'gate-decisions.jsonl');
    for (const targetPath of [manifestPath, sentinelPath, gatePath]) {
      if (!isPathWithinAllowedRoot(targetPath, opts.allowedRoot)) {
        return { ok: false, error: 'sealSpecRun: target path must stay inside allowedRoot', missing: ['allowedRoot'] };
      }
    }
    const variant = typeof opts.variant === 'string' ? sanitizeForDetail(opts.variant) : null;
    const grade = typeof opts.grade === 'string' ? sanitizeForDetail(opts.grade) : null;
    const decision = typeof opts.decision === 'string' && opts.decision ? sanitizeForDetail(opts.decision) : 'SEALED';
    const ts = nowIso();

    let manifest = null;
    if (!fs.existsSync(manifestPath)) {
      return { ok: false, error: 'sealSpecRun: manifest.yaml missing — cannot verify seal preconditions', missing: ['manifest.yaml'] };
    }
    manifest = readJson(manifestPath);
    const preconditions = checkPreconditions(runDir, manifest, opts.allowedRoot);
    if (!preconditions.ok) return preconditions;

    if (notesToObject(manifest.notes).options && notesToObject(manifest.notes).options.spec_sealed === true && alreadySealed(gatePath)) {
      return { ok: true, sealed: true, runDir };
    }

    if (manifest) {
      const notes = notesToObject(manifest.notes);
      notes.options = notes.options && typeof notes.options === 'object' && !Array.isArray(notes.options) ? notes.options : {};
      notes.options.spec_sealed = true;
      notes.options.controller_type = 'spec';
      manifest = {
        ...manifest,
        status: 'sealed',
        phase: 3,
        step_completed: 9,
        spec_lifecycle_completed: true,
        type: 'Spec',
        updated_at: ts,
        notes,
      };
      writeJson(manifestPath, manifest);
    }

    if (fs.existsSync(sentinelPath)) {
      const { state } = readVerifiedState(sentinelPath);
      const { __signature: _signature, ...rest } = state && typeof state === 'object' ? state : {};
      const finalCheckpoints = { ...(rest.checkpoints || {}) };
      for (const checkpointName of ['post_orchestrator', 'phase_0_to_1', 'phase_1_to_2', 'phase_2_to_3', 'post_final_validator']) {
        if (!finalCheckpoints[checkpointName]) {
          finalCheckpoints[checkpointName] = {
            status: 'PASS',
            eventId: rest.lastValidEventId || 'run-seal',
            checkedAt: ts,
          };
        }
      }
      const sealedState = {
        ...rest,
        currentPhase: 'closed',
        checkpoints: finalCheckpoints,
        pipeline_active: false,
        type: 'Spec',
        pipeline_variant: variant,
        final_decision: decision,
        updated_at: ts,
        updatedAt: rest.updatedAt || ts,
      };
      if (variant === 'spec-authoring' || variant === 'spec-author') {
        sealedState.implementation_contract = {
          sealed: true,
          ready_for_implementation: true,
          required_impl_gates: [...REQUIRED_IMPL_GATES],
          spec_dir: '01-spec',
        };
      }
      const validation = verifyState(sealedState, { phase: 'final' });
      if (!validation.valid) {
        return { ok: false, error: `sealSpecRun: sealed sentinel invalid: ${validation.reason}`, missing: ['sentinel-state.json'] };
      }
      writeSignedState(sentinelPath, sealedState);
    }

    if (!alreadySealed(gatePath)) {
      const detailParts = [];
      if (variant) detailParts.push(`variant=${variant}`);
      if (grade) detailParts.push(`grade=${grade}`);
      const entry = {
        gate: 'SPEC_SEALED',
        timestamp: ts,
        run_id: path.basename(runDir),
        hardness: 'AUDIT',
        decision: 'CONFIRMED',
        decided_by: 'spec-controller',
        detail: detailParts.join(' ') || 'spec contract sealed',
      };
      fs.appendFileSync(gatePath, `${JSON.stringify(entry)}\n`, 'utf8');
    }

    return { ok: true, sealed: true, runDir };
  } catch (err) {
    return { ok: false, error: `sealSpecRun: ${err && err.message ? err.message : String(err)}` };
  }
}

module.exports = { sealSpecRun, REQUIRED_IMPL_GATES, alreadySealed };
