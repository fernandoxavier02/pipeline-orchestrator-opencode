'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  validateEvidenceRecord,
  validateGateDecisionRecord,
  validateProtocolEventRecord,
  validateProtocolEventSequence,
} = require('../validators/contract-validator.cjs');

const REQUIRED_ARTIFACTS = Object.freeze(['gate-decisions.jsonl', 'protocol-events.jsonl', 'evidence.jsonl']);

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveForContainment(filePath) {
  const resolved = path.resolve(filePath);
  const missingParts = [];
  let current = resolved;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return resolved;
    missingParts.unshift(path.basename(current));
    current = parent;
  }
  try {
    const real = fs.realpathSync.native ? fs.realpathSync.native(current) : fs.realpathSync(current);
    return missingParts.length > 0 ? path.join(real, ...missingParts) : real;
  } catch (_) {
    return resolved;
  }
}

function defaultAllowedRoot() {
  return path.resolve(__dirname, '..', '..', 'tmp');
}

function assertRunDirAllowed(runDir, allowedRoot = defaultAllowedRoot()) {
  const realRoot = resolveForContainment(allowedRoot);
  const realRunDir = resolveForContainment(runDir);
  if (!isInside(realRoot, realRunDir)) throw new Error('runDir must be inside adaptation tmp');
}

function readJsonl(filePath) {
  const records = [];
  const errors = [];
  if (!fs.existsSync(filePath)) return { records, errors };
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    try {
      records.push(JSON.parse(line));
    } catch (err) {
      errors.push(`${path.basename(filePath)} line ${index + 1}: malformed JSON`);
    }
  });
  return { records, errors };
}

function loadRunArtifacts(runDir, options = {}) {
  if (typeof runDir !== 'string' || !path.isAbsolute(runDir)) throw new TypeError('runDir must be absolute');
  assertRunDirAllowed(runDir, options.allowedRoot || defaultAllowedRoot());
  const missing = REQUIRED_ARTIFACTS.filter((name) => !fs.existsSync(path.join(runDir, name)));
  const decisions = readJsonl(path.join(runDir, 'gate-decisions.jsonl'));
  const events = readJsonl(path.join(runDir, 'protocol-events.jsonl'));
  const evidence = readJsonl(path.join(runDir, 'evidence.jsonl'));
  const artifacts = {
    runDir,
    missing,
    parseErrors: [...decisions.errors, ...events.errors, ...evidence.errors],
    decisions: decisions.records,
    events: events.records,
    evidence: evidence.records,
  };
  return artifacts;
}

function validateRunArtifacts(artifacts) {
  const errors = [];
  if (!artifacts || typeof artifacts !== 'object') return { ok: false, errors: ['artifacts required'] };
  for (const name of artifacts.missing || []) errors.push(`missing ${name}`);
  for (const error of artifacts.parseErrors || []) errors.push(error);
  for (const [index, record] of (artifacts.decisions || []).entries()) {
    const result = validateGateDecisionRecord(record);
    if (!result.ok) errors.push(`gate-decisions[${index}]: ${result.message || result.code}`);
  }
  for (const [index, record] of (artifacts.events || []).entries()) {
    const result = validateProtocolEventRecord(record);
    if (!result.ok) errors.push(`protocol-events[${index}]: ${result.message || result.code}`);
  }
  const sequence = validateProtocolEventSequence(artifacts.events || []);
  if (!sequence.ok) errors.push(`protocol-events sequence: ${sequence.message || sequence.code}`);
  for (const [index, record] of (artifacts.evidence || []).entries()) {
    const result = validateEvidenceRecord(record);
    if (!result.ok) errors.push(`evidence[${index}]: ${result.message || result.code}`);
    if (typeof record.artifactRef === 'string' && record.artifactRef) {
      if (path.isAbsolute(record.artifactRef)) {
        errors.push(`evidence[${index}]: artifactRef must be relative: ${record.artifactRef}`);
        continue;
      }
      const stateRoot = path.resolve(artifacts.runDir, '..', '..');
      const artifactPath = path.resolve(stateRoot, record.artifactRef);
      if (!isInside(resolveForContainment(stateRoot), resolveForContainment(artifactPath))) {
        errors.push(`evidence[${index}]: artifactRef outside run state: ${record.artifactRef}`);
        continue;
      }
      if (!fs.existsSync(artifactPath)) errors.push(`evidence[${index}]: artifactRef missing: ${record.artifactRef}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function gatePhasePairs(decisions) {
  return (decisions || []).map((decision) => `${decision.gate}@${decision.phase}`);
}

function compareGatePhaseParity(actualArtifacts, reference) {
  const actualPairs = gatePhasePairs(actualArtifacts.decisions || []);
  const expectedPairs = (reference.expectedGatePhases || []).map((item) => `${item.gate}@${item.phase}`);
  const remaining = actualPairs.slice();
  const missing = [];
  let matched = 0;
  for (const expected of expectedPairs) {
    const index = remaining.indexOf(expected);
    if (index === -1) {
      missing.push(expected);
    } else {
      matched += 1;
      remaining.splice(index, 1);
    }
  }
  const extra = remaining;
  const matchRatio = expectedPairs.length === 0 ? 1 : matched / expectedPairs.length;
  const failOnExtra = reference.failOnExtra !== false;
  return {
    ok: missing.length === 0 && (!failOnExtra || extra.length === 0),
    matched,
    expected: expectedPairs.length,
    matchRatio,
    missing,
    extra,
  };
}

function compareGatePhaseCoincidence(actualArtifacts, canonicalArtifacts, options = {}) {
  const actualPairs = gatePhasePairs(actualArtifacts.decisions || []);
  const canonicalPairs = gatePhasePairs(canonicalArtifacts.decisions || []);
  const remaining = actualPairs.slice();
  const missing = [];
  let matched = 0;
  for (const canonical of canonicalPairs) {
    const index = remaining.indexOf(canonical);
    if (index === -1) {
      missing.push(canonical);
    } else {
      matched += 1;
      remaining.splice(index, 1);
    }
  }
  const matchRatio = canonicalPairs.length === 0 ? 1 : matched / canonicalPairs.length;
  const threshold = typeof options.threshold === 'number' ? options.threshold : 0.9;
  return {
    ok: matchRatio >= threshold,
    threshold,
    matched,
    canonical: canonicalPairs.length,
    actual: actualPairs.length,
    matchRatio,
    missing,
    extra: remaining,
  };
}

function verifyE2EParityRun(runDir, reference, options = {}) {
  const artifacts = loadRunArtifacts(runDir, options);
  const validation = validateRunArtifacts(artifacts);
  const parity = compareGatePhaseParity(artifacts, reference || { expectedGatePhases: [] });
  return {
    ok: validation.ok && parity.ok,
    artifacts,
    validation,
    parity,
  };
}

function compareCanonicalRunDirs(actualRunDir, canonicalRunDir, options = {}) {
  const actualArtifacts = loadRunArtifacts(actualRunDir, { allowedRoot: options.actualAllowedRoot || options.allowedRoot });
  const canonicalArtifacts = loadRunArtifacts(canonicalRunDir, { allowedRoot: options.canonicalAllowedRoot || options.allowedRoot });
  const actualValidation = validateRunArtifacts(actualArtifacts);
  const canonicalValidation = validateRunArtifacts(canonicalArtifacts);
  const comparison = compareGatePhaseCoincidence(actualArtifacts, canonicalArtifacts, { threshold: options.threshold });
  return {
    ok: actualValidation.ok && canonicalValidation.ok && comparison.ok,
    actual: {
      artifacts: actualArtifacts,
      validation: actualValidation,
    },
    canonical: {
      artifacts: canonicalArtifacts,
      validation: canonicalValidation,
    },
    comparison,
  };
}

module.exports = {
  REQUIRED_ARTIFACTS,
  compareGatePhaseParity,
  compareGatePhaseCoincidence,
  compareCanonicalRunDirs,
  defaultAllowedRoot,
  gatePhasePairs,
  loadRunArtifacts,
  readJsonl,
  assertRunDirAllowed,
  validateRunArtifacts,
  verifyE2EParityRun,
};
