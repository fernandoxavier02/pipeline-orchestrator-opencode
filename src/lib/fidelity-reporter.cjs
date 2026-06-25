'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = '1.0.0';
const VALID_COMPLEXITY = new Set(['SIMPLES', 'MEDIA', 'COMPLEXA']);

const MANDATORY_GATES_BY_COMPLEXITY = Object.freeze({
  SIMPLES: Object.freeze([
    'STATE_FILE_INIT_FAIL',
    'INFO_GATE_BLOCKED',
    'TDD_APPROVAL',
    'CHECKPOINT_FAIL',
    'COMPLEXITY_GATE',
    'CLOSEOUT_CONFIRM',
    'PLAN_REJECTED',
    'ADVERSARIAL_GATE',
    'ADVERSARIAL_BLOCK',
    'FIX_LOOP_EXHAUSTED',
    'ADVERSARIAL_LOOP_BREAKER',
  ]),
  MEDIA: Object.freeze([
    'STATE_FILE_INIT_FAIL',
    'INFO_GATE_BLOCKED',
    'TDD_APPROVAL',
    'CHECKPOINT_FAIL',
    'COMPLEXITY_GATE',
    'CLOSEOUT_CONFIRM',
    'PLAN_REJECTED',
    'ADVERSARIAL_GATE',
    'ADVERSARIAL_BLOCK',
    'FIX_LOOP_EXHAUSTED',
    'ADVERSARIAL_LOOP_BREAKER',
    'MICRO_GATE_GAP',
    'STOP_RULE',
  ]),
  COMPLEXA: Object.freeze([
    'STATE_FILE_INIT_FAIL',
    'INFO_GATE_BLOCKED',
    'TDD_APPROVAL',
    'CHECKPOINT_FAIL',
    'COMPLEXITY_GATE',
    'CLOSEOUT_CONFIRM',
    'PLAN_REJECTED',
    'ADVERSARIAL_GATE',
    'ADVERSARIAL_BLOCK',
    'MICRO_GATE_GAP',
    'STOP_RULE',
    'ADVERSARIAL_LOOP_BREAKER',
    'FINAL_ADVERSARIAL_GATE',
    'FINAL_ADVERSARIAL_REWORK',
    'FIX_LOOP_EXHAUSTED',
    'ADVERSARIAL_GATE_MANDATORY',
    'SSOT_CONFLICT',
    'STALE_CONTEXT',
  ]),
  SPEC: Object.freeze([
    'SPEC_ARTIFACT_MISSING',
    'SPEC_FORMAT_GATE_FAIL',
    'SPEC_CONTENT_REVIEW_NOGO',
    'SPEC_AC_TRACEABILITY_GAP',
    'SPEC_POST_IMPL_FAIL',
    'ADVERSARIAL_LOOP_CHECKPOINT',
  ]),
  SPEC_AUTHORING: Object.freeze([
    'SPEC_SEALED',
    'SPEC_REVIEW_FINDINGS',
  ]),
});

const AUTHORING_VARIANTS = new Set(['spec-authoring', 'spec-author']);

function isAuthoringVariant(variant) {
  if (typeof variant !== 'string' || !variant) return false;
  return AUTHORING_VARIANTS.has(variant.trim().toLowerCase());
}

function mandatorySetFor(complexity, type, variant) {
  if (isAuthoringVariant(variant)) return MANDATORY_GATES_BY_COMPLEXITY.SPEC_AUTHORING.slice();
  const base = MANDATORY_GATES_BY_COMPLEXITY[complexity] || [];
  const out = base.slice();
  if (type === 'Spec') {
    for (const gate of MANDATORY_GATES_BY_COMPLEXITY.SPEC) {
      if (!out.includes(gate)) out.push(gate);
    }
  }
  return out;
}

function containedIn(parent, child) {
  const resolvedParent = resolveForContainment(parent);
  const resolvedChild = resolveForContainment(child);
  const relative = path.relative(resolvedParent, resolvedChild);
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

function sanitizeText(value) {
  if (value == null) return '';
  return String(value).replace(/[\t\n\r]/g, ' ').replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, 200);
}

function escapeMdCell(value) {
  return sanitizeText(value).replace(/\|/g, '\\|');
}

function assertContainedPath(root, filePath) {
  if (!containedIn(root, filePath)) throw new Error(`path-traversal: ${path.basename(filePath)} outside repoRoot`);
}

function writeFileAtomicContained(root, filePath, content) {
  assertContainedPath(root, filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  assertContainedPath(root, tmpPath);
  let renamed = false;
  try {
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, filePath);
    renamed = true;
  } finally {
    if (!renamed) {
      try { fs.rmSync(tmpPath, { force: true }); } catch (_) { /* best effort */ }
    }
  }
}

function readGateDecisions(filePath, allowedRoot) {
  assertContainedPath(allowedRoot, filePath);
  if (!fs.existsSync(filePath)) return { entries: [], existed: false, warnings: [] };
  const warnings = [];
  const entries = [];
  const raw = fs.readFileSync(filePath, 'utf8');
  let lineNumber = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    lineNumber += 1;
    try {
      const entry = JSON.parse(line);
      if (entry && typeof entry === 'object' && !Array.isArray(entry) && typeof entry.gate === 'string') {
        entries.push(entry);
      } else {
        warnings.push(`line ${lineNumber}: missing gate field`);
      }
    } catch (_) {
      warnings.push(`line ${lineNumber}: malformed JSON`);
    }
  }
  return { entries, existed: true, warnings };
}

function generateFidelityReport(opts) {
  try {
    if (!opts || typeof opts !== 'object' || Array.isArray(opts)) return { ok: false, error: 'opts object required' };
    const { pipelineDocPath, repoRoot, type, variant = null, runId } = opts;
    let { complexity } = opts;
    if (isAuthoringVariant(variant) && (!complexity || typeof complexity !== 'string' || !VALID_COMPLEXITY.has(complexity))) {
      complexity = 'MEDIA';
    }
    if (typeof pipelineDocPath !== 'string' || !pipelineDocPath) return { ok: false, error: 'pipelineDocPath required' };
    if (typeof repoRoot !== 'string' || !repoRoot) return { ok: false, error: 'repoRoot required' };
    if (!path.isAbsolute(repoRoot)) return { ok: false, error: 'path-traversal: repoRoot must be absolute' };
    if (!path.isAbsolute(pipelineDocPath)) return { ok: false, error: 'path-traversal: pipelineDocPath must be absolute' };
    if (!containedIn(repoRoot, pipelineDocPath)) return { ok: false, error: 'path-traversal: pipelineDocPath outside repoRoot' };
    if (typeof complexity !== 'string' || !complexity) return { ok: false, error: 'complexity required' };
    if (!VALID_COMPLEXITY.has(complexity)) return { ok: false, error: `invalid complexity: ${complexity}` };
    if (typeof type !== 'string' || !type) return { ok: false, error: 'type required' };

    const mandatorySet = mandatorySetFor(complexity, type, variant);
    const mandatoryIndex = new Set(mandatorySet);
    const gateLogPath = path.join(pipelineDocPath, 'gate-decisions.jsonl');
    const { entries, existed, warnings } = readGateDecisions(gateLogPath, repoRoot);
    const mandatoryGatesData = Object.create(null);
    const otherGatesMap = new Map();
    for (const entry of entries) {
      const record = {
        hardness: sanitizeText(entry.hardness) || null,
        decision: sanitizeText(entry.decision) || null,
      };
      if (mandatoryIndex.has(entry.gate)) {
        mandatoryGatesData[entry.gate] = record;
      } else {
        otherGatesMap.set(entry.gate, {
          gate: sanitizeText(entry.gate),
          hardness: record.hardness,
          decision: record.decision,
          detail: sanitizeText(entry.detail),
        });
      }
    }
    const mandatoryExpected = mandatorySet.length;
    const mandatoryTriggered = Object.keys(mandatoryGatesData).length;
    const fidelityScore = (!existed || entries.length === 0 || mandatoryExpected === 0) ? null : mandatoryTriggered / mandatoryExpected;
    const resolvedRunId = runId || path.basename(pipelineDocPath.replace(/[\\/]+$/, '')) || 'unknown-run';
    const report = {
      schema_version: SCHEMA_VERSION,
      run_id: resolvedRunId,
      pipeline_doc_path: pipelineDocPath,
      type,
      complexity,
      variant: variant || null,
      mandatory_triggered: mandatoryTriggered,
      mandatory_expected: mandatoryExpected,
      fidelity_score: fidelityScore === null ? null : Math.round(fidelityScore * 10000) / 10000,
      global_fidelity_pct: null,
      mandatory_gates: mandatorySet.map((gate) => {
        const found = mandatoryGatesData[gate];
        return {
          gate,
          hardness: found ? found.hardness : null,
          expected: true,
          triggered: !!found,
          decision: found ? found.decision : null,
        };
      }),
      other_gates: Array.from(otherGatesMap.values()),
      warnings,
      generated_at: new Date().toISOString(),
    };
    fs.mkdirSync(pipelineDocPath, { recursive: true });
    const jsonPath = path.join(pipelineDocPath, 'fidelity-report.json');
    const mdPath = path.join(pipelineDocPath, 'fidelity-report.md');
    assertContainedPath(repoRoot, jsonPath);
    assertContainedPath(repoRoot, mdPath);
    writeFileAtomicContained(repoRoot, jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    const score = report.fidelity_score === null ? 'n/a (no gate data)' : report.fidelity_score.toFixed(4);
    const mandatoryRows = report.mandatory_gates.map((gate) => `| ${escapeMdCell(gate.gate)} | ${escapeMdCell(gate.hardness || '-')} | yes | ${gate.triggered ? 'yes' : 'NO'} | ${escapeMdCell(gate.decision || '-')} |`).join('\n');
    const otherRows = report.other_gates.length
      ? report.other_gates.map((gate) => `| ${escapeMdCell(gate.gate)} | ${escapeMdCell(gate.hardness || '-')} | ${escapeMdCell(gate.decision || '-')} | ${escapeMdCell(gate.detail || '')} |`).join('\n')
      : '| - | - | - | (none) |';
    writeFileAtomicContained(repoRoot, mdPath, [
      `# Fidelity Report - ${escapeMdCell(resolvedRunId)}`,
      '',
      '## Summary',
      '',
      `- Run ID: ${escapeMdCell(resolvedRunId)}`,
      `- Mandatory gates triggered: ${mandatoryTriggered} / ${mandatoryExpected}`,
      `- Fidelity score: ${score}`,
      '',
      '## Mandatory Gates Coverage',
      '',
      '| Gate | Hardness | Expected? | Triggered? | Decision |',
      '|------|----------|-----------|------------|----------|',
      mandatoryRows || '| - | - | - | - | - |',
      '',
      '## Non-Mandatory Gates Observed',
      '',
      '| Gate | Hardness | Decision | Detail (truncated) |',
      '|------|----------|----------|--------------------|',
      otherRows,
      '',
    ].join('\n'));
    return { ok: true, fidelityScore, mandatoryTriggered, mandatoryExpected, globalFidelityPct: null, mdPath, jsonPath, warnings };
  } catch (err) {
    return { ok: false, error: `generateFidelityReport: ${err.message}` };
  }
}

module.exports = {
  generateFidelityReport,
  MANDATORY_GATES_BY_COMPLEXITY,
  SCHEMA_VERSION,
  isAuthoringVariant,
  mandatorySetFor,
};
