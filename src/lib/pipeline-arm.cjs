'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { redactString } = require('../validators/redactor.cjs');

let classifier = null;
try { classifier = require('./pipeline-workflow-classifier.cjs'); } catch { classifier = null; }

let signer = null;
try { signer = require('./sentinel-state-signer.cjs'); } catch { signer = null; }

function markerPath(cwd) {
  return path.join(cwd, '.pipeline', 'pipeline-arm-pending.json');
}

function realpath(value) {
  return fs.realpathSync.native ? fs.realpathSync.native(value) : fs.realpathSync(value);
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function ensurePipelineDir(cwd) {
  const root = realpath(cwd);
  const pipelineDir = path.join(cwd, '.pipeline');
  if (!fs.existsSync(pipelineDir)) fs.mkdirSync(pipelineDir, { recursive: true });
  const resolvedPipelineDir = realpath(pipelineDir);
  if (!isInside(root, resolvedPipelineDir)) {
    throw new Error('pipeline arm marker path resolves outside project');
  }
  return resolvedPipelineDir;
}

function existingPipelineDir(cwd) {
  const root = realpath(cwd);
  const pipelineDir = path.join(cwd, '.pipeline');
  if (!fs.existsSync(pipelineDir)) return null;
  const resolvedPipelineDir = realpath(pipelineDir);
  if (!isInside(root, resolvedPipelineDir)) return null;
  return resolvedPipelineDir;
}

function writeJsonAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `pipeline-arm-pending.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  let fd = null;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(value, null, 2));
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, filePath);
  } catch (err) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

function writeArmPending(cwd, rawPrompt, nowIso) {
  if (typeof cwd !== 'string' || !cwd) return null;
  if (!classifier || typeof classifier.isPipelineInvocation !== 'function') return null;
  if (!classifier.isPipelineInvocation(rawPrompt)) return null;

  const wf = classifier.classifyWorkflow(rawPrompt);
  const marker = {
    requested_at: nowIso || new Date().toISOString(),
    workflow: wf.mode + (wf.type ? (`/${wf.type}`) : ''),
    mode: wf.mode,
    type: wf.type,
    variant: wf.variant,
    complexity: wf.complexity,
    source: wf.source,
    prompt_excerpt: redactString(String(rawPrompt == null ? '' : rawPrompt))
      .replace(/[\r\n]+/g, ' ')
      .slice(0, 200),
  };

  let toWrite = marker;
  if (signer && typeof signer.signState === 'function') {
    try { toWrite = signer.signState(marker); } catch { toWrite = marker; }
  }

  const p = path.join(ensurePipelineDir(cwd), 'pipeline-arm-pending.json');
  writeJsonAtomic(p, toWrite);
  return marker;
}

function clearArmPending(cwd) {
  try {
    const pipelineDir = existingPipelineDir(cwd);
    if (!pipelineDir) return false;
    fs.unlinkSync(path.join(pipelineDir, 'pipeline-arm-pending.json'));
    return true;
  } catch {
    return false;
  }
}

module.exports = { writeArmPending, clearArmPending, markerPath };
