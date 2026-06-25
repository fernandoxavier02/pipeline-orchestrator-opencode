'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { writeSignedState } = require('./sentinel-state-signer.cjs');

const MAX_ALLOCATE_ATTEMPTS = 6;

function sanitizePrompt(input) {
  return String(input || '')
    .replace(/\b(password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=REDACTED')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer REDACTED')
    .replace(/\b(sk-[A-Za-z0-9_-]{10,}|gh[pousr]_[A-Za-z0-9_]{10,}|github_pat_[A-Za-z0-9_]{10,}|glpat-[A-Za-z0-9_-]{10,}|npm_[A-Za-z0-9_-]{10,}|xox[baprs]-[A-Za-z0-9-]{10,}|A[SK]IA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,})\b/g, 'REDACTED');
}

function slugify(input) {
  const slug = String(input || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join('-');
  return slug || 'run';
}

function nextRunNumber(rootDir) {
  if (!fs.existsSync(rootDir)) return '001';
  const ordinals = fs.readdirSync(rootDir)
    .map((name) => name.match(/^(\d{3})-/))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  const max = ordinals.length ? Math.max(...ordinals) : 0;
  return String(max + 1).padStart(3, '0');
}

function generateUniqueId() {
  return `${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  let renamed = false;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2) + '\n');
    fs.renameSync(tmpPath, filePath);
    renamed = true;
  } finally {
    if (!renamed) {
      try { fs.rmSync(tmpPath, { force: true }); } catch (_err) { /* best effort */ }
    }
  }
}

function writeTelemetryBridge(rootDir, runDirectory, manifest, now) {
  if (path.basename(rootDir) !== 'pipeline-runs') {
    throw new Error(`writeTelemetryBridge: rootDir basename must be 'pipeline-runs' (got '${path.basename(rootDir)}')`);
  }
  const projectRoot = path.dirname(rootDir);
  const pointerPath = path.join(projectRoot, '.pipeline', 'active-run.json');
  writeSignedState(path.join(runDirectory.absPath, 'sentinel-state.json'), {
    schemaVersion: 'SENTINEL_STATE/v1',
    runId: runDirectory.runId,
    currentPhase: 'phase_0',
    checkpoints: {},
    blocked: false,
    stopRuleTriggered: false,
    lastValidEventId: null,
    updatedAt: now,
    pipeline_active: true,
    type: manifest.type,
    complexity: manifest.complexity,
    notes: manifest.notes,
  });
  writeJsonAtomic(pointerPath, {
    pipeline_doc_path: runDirectory.absPath,
    run_id: runDirectory.runId,
    updated_at: now,
  });
}

class RunDirectory {
  constructor(rootDir, runNumber, uniqueId, slug) {
    this._rootDir = rootDir;
    this._runNumber = runNumber;
    this._uniqueId = uniqueId;
    this._slug = slug;
  }

  get runNumber() { return this._runNumber; }
  get uniqueId() { return this._uniqueId; }
  get slug() { return this._slug; }
  get runId() { return `${this._runNumber}-${this._uniqueId}-${this._slug}`; }
  get absPath() { return path.join(this._rootDir, this.runId); }

  static allocate(rootDir, prompt) {
    if (typeof rootDir !== 'string' || !path.isAbsolute(rootDir)) {
      throw new TypeError('RunDirectory.allocate: rootDir must be absolute');
    }
    if (path.basename(rootDir) !== 'pipeline-runs') {
      throw new Error("RunDirectory.allocate: rootDir basename must be 'pipeline-runs'");
    }
    fs.mkdirSync(rootDir, { recursive: true });
    const realRoot = fs.realpathSync(rootDir);
    const runNumber = nextRunNumber(realRoot);
    const baseSlug = slugify(prompt);

    for (let attempt = 0; attempt < MAX_ALLOCATE_ATTEMPTS; attempt += 1) {
      const uniqueId = generateUniqueId();
      const run = new RunDirectory(realRoot, runNumber, uniqueId, baseSlug);
      try {
        fs.mkdirSync(run.absPath, { recursive: false });
      } catch (err) {
        if (err && err.code === 'EEXIST') continue;
        throw err;
      }
      for (const subdir of ['00-brainstorm', '01-spec', '02-validations', '03-execution', 'attachments']) {
        fs.mkdirSync(path.join(run.absPath, subdir), { recursive: true });
      }
      const now = new Date().toISOString();
      const manifest = {
        schema_version: 1,
        run_id: run.runId,
        created_at: now,
        updated_at: now,
        status: 'ready',
        phase: 0,
        step_completed: null,
        type: 'Unknown',
        complexity: 'unknown',
        brainstorm_completed: false,
        spec_lifecycle_completed: false,
        handoff_decision: null,
        linked_pipeline_doc_path: null,
        notes: { prompt: sanitizePrompt(prompt), options: {} },
      };
      writeJsonAtomic(path.join(run.absPath, 'manifest.yaml'), manifest);
      writeTelemetryBridge(realRoot, run, manifest, now);
      process.env.PIPELINE_RUN_ID = run.runId;
      return run;
    }
    throw new Error(`RunDirectory.allocate: ${MAX_ALLOCATE_ATTEMPTS} attempts exhausted`);
  }
}

module.exports = { RunDirectory, slugify, generateUniqueId, writeTelemetryBridge };
