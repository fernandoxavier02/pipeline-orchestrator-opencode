'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { CORRUPT_SENTINEL, findActiveSentinelState } = require('../state/sentinel-state-inspector.cjs');
const { projectDirFromInput } = require('./step-ledger-gate.cjs');

const DENY_MODE_START_ISO = '2026-05-17';
const SKILL_NAME_RE = /^[A-Za-z0-9._-]{1,128}$/;
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function safeKey(key) {
  return typeof key === 'string' && key.length > 0 && !BLOCKED_KEYS.has(key);
}

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if ((ch === '"' || ch === "'") && line[i - 1] !== '\\') quote = quote === ch ? null : quote || ch;
    if (ch === '#' && !quote) return line.slice(0, i);
  }
  return line;
}

function coerce(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (text === '') return null;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null' || text === '~') return null;
  if (/^-?\d+$/.test(text)) return Number.parseInt(text, 10);
  if (/^-?\d+\.\d+$/.test(text)) return Number.parseFloat(text);
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) return text.slice(1, -1);
  return text;
}

function parseInlineObject(text) {
  const object = {};
  for (const part of text.slice(1, -1).split(',').map((item) => item.trim()).filter(Boolean)) {
    const colon = part.indexOf(':');
    if (colon <= 0) continue;
    const key = part.slice(0, colon).trim();
    if (safeKey(key)) object[key] = coerce(part.slice(colon + 1).trim());
  }
  return object;
}

function parseYaml(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map(stripComment)
    .filter((line) => line.trim().length > 0);
  const root = {};
  const stack = [{ indent: -1, value: root, type: 'object' }];

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const indent = raw.match(/^(\s*)/)[1].length;
    const line = raw.trim();
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const top = stack[stack.length - 1];

    if (line.startsWith('- ')) {
      if (top.type !== 'array') continue;
      const item = line.slice(2).trim();
      top.value.push(item.startsWith('{') && item.endsWith('}') ? parseInlineObject(item) : coerce(item));
      continue;
    }

    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    if (!safeKey(key)) continue;
    const value = match[2].trim();

    if (value.startsWith('[') && value.endsWith(']')) {
      top.value[key] = value.slice(1, -1).split(',').map((item) => coerce(item.trim())).filter((item) => item !== null && item !== '');
    } else if (value.length === 0) {
      const next = lines[i + 1];
      if (next && next.trim().startsWith('- ')) {
        const array = [];
        top.value[key] = array;
        stack.push({ indent, value: array, type: 'array' });
      } else {
        const child = {};
        top.value[key] = child;
        stack.push({ indent, value: child, type: 'object' });
      }
    } else {
      top.value[key] = coerce(value);
    }
  }

  return root;
}

function parseFrontmatter(text) {
  if (typeof text !== 'string') return { ok: false, error: 'input is not a string' };
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!match) return { ok: false, error: 'no frontmatter block found' };
  try {
    return { ok: true, frontmatter: parseYaml(match[1]) };
  } catch (error) {
    return { ok: false, error: `yaml parse failed: ${error.message}` };
  }
}

function containedIn(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function realpathIfExists(filePath) {
  const read = fs.realpathSync.native || fs.realpathSync;
  return read(filePath);
}

function containedInReal(parent, child) {
  try {
    return containedIn(realpathIfExists(parent), realpathIfExists(child));
  } catch (_) {
    return false;
  }
}

function readSkillFrontmatter(skillName, repoRoot) {
  if (!SKILL_NAME_RE.test(String(skillName || ''))) return { ok: false, error: 'invalid skill name' };
  const roots = [path.resolve(repoRoot, '.opencode', 'skills'), path.resolve(repoRoot, 'skills')];
  const candidates = roots.map((root) => ({ root, skillPath: path.resolve(root, skillName, 'SKILL.md') }));
  const selected = candidates.find((candidate) => fs.existsSync(candidate.skillPath)) || candidates[0];
  const { root: skillsRoot, skillPath } = selected;
  if (!containedIn(skillsRoot, skillPath)) return { ok: false, error: 'invalid skill name' };
  if (fs.existsSync(skillsRoot) && !containedInReal(repoRoot, skillsRoot)) return { ok: false, error: 'invalid skills root' };
  if (fs.existsSync(skillPath) && !containedInReal(skillsRoot, skillPath)) return { ok: false, error: 'invalid skill path' };
  let text;
  try {
    text = fs.readFileSync(skillPath, 'utf8');
  } catch (error) {
    return { ok: false, error: `cannot read skill frontmatter: ${error.code || error.message}` };
  }
  const result = parseFrontmatter(text);
  if (!result.ok) return result;
  return { ok: true, frontmatter: result.frontmatter, source: skillPath };
}

function getCurrentSkill(state) {
  if (!state || typeof state !== 'object') return null;
  if (!state.current_skill || typeof state.current_skill !== 'string') return null;
  return {
    skill: state.current_skill,
    step: typeof state.current_step === 'number' ? state.current_step : null,
    expected_next: state.expected_next || null,
  };
}

function getVariantSkill(state) {
  if (!state || typeof state !== 'object') return null;
  if (state.current_skill && typeof state.current_skill === 'string') return null;
  const variant = state.variant || state.pipeline_variant || (state.orchestrator_decision && state.orchestrator_decision.pipeline_variant);
  if (!variant || typeof variant !== 'string') return null;
  if (variant === 'DIRETO' || variant.startsWith('spec-')) return null;
  return {
    skill: variant,
    step: typeof state.current_step === 'number' ? state.current_step : null,
    expected_next: state.expected_next || null,
    via_variant: true,
  };
}

function enforceSkillContract(state, repoRoot) {
  const ctx = getCurrentSkill(state) || getVariantSkill(state);
  if (!ctx || ctx.step === null) return { ok: true, enforced: false };
  const skillResult = readSkillFrontmatter(ctx.skill, repoRoot);
  if (!skillResult.ok) {
    return {
      ok: false,
      enforced: true,
      violation: `cannot verify skill frontmatter for ${ctx.skill}: ${skillResult.error}`,
      hint: 'Pipeline skill frontmatter must be readable before checkpoint enforcement can proceed.',
      skill: ctx.skill,
      step: ctx.step,
    };
  }
  const checkpoints = skillResult.frontmatter.sentinel_checkpoints;
  if (Object.prototype.hasOwnProperty.call(skillResult.frontmatter, 'sentinel_checkpoints') && !Array.isArray(checkpoints)) {
    return {
      ok: false,
      enforced: true,
      violation: `invalid sentinel_checkpoints frontmatter for ${ctx.skill}`,
      hint: 'sentinel_checkpoints must be a list before checkpoint enforcement can proceed.',
      skill: ctx.skill,
      step: ctx.step,
      source: skillResult.source,
    };
  }
  if (!Array.isArray(checkpoints)) return { ok: true, enforced: false };
  const stepLabel = `pre_${ctx.step}`;
  const checkpointMatches = checkpoints.some((checkpoint) => checkpoint === ctx.step || String(checkpoint) === stepLabel);
  if (!checkpointMatches) return { ok: true, enforced: false };
  if (!ctx.expected_next || String(ctx.expected_next).trim() === '') {
    return {
      ok: false,
      enforced: true,
      violation: `checkpoint ${stepLabel} reached but expected_next not set in state`,
      hint: 'Controller must set expected_next before spawning Agent at checkpoint steps',
      skill: ctx.skill,
      step: ctx.step,
      source: skillResult.source,
    };
  }
  return { ok: true, enforced: true, skill: ctx.skill, step: ctx.step, expected_next: ctx.expected_next, source: skillResult.source };
}

function getEnforcementMode(today) {
  const override = String(process.env.PIPELINE_ENFORCEMENT || '').toLowerCase();
  if (process.env.PIPELINE_ENFORCEMENT_ALLOW_OVERRIDE === '1' && (override === 'warn' || override === 'deny')) return override;
  const now = today instanceof Date ? today : new Date();
  return now >= new Date(`${DENY_MODE_START_ISO}T00:00:00Z`) ? 'deny' : 'warn';
}

function logEnforcementDecision(repoRoot, decision = {}) {
  if (!decision.pipeline_doc_path) return false;
  const pipelineRoot = path.resolve(repoRoot, '.pipeline');
  if (fs.existsSync(pipelineRoot) && !containedInReal(repoRoot, pipelineRoot)) return false;
  if (!containedIn(pipelineRoot, decision.pipeline_doc_path)) return false;
  if (!fs.existsSync(decision.pipeline_doc_path) || !containedInReal(pipelineRoot, decision.pipeline_doc_path)) return false;
  const logPath = path.join(decision.pipeline_doc_path, 'gate-decisions.jsonl');
  if (fs.existsSync(logPath) && !containedInReal(pipelineRoot, logPath)) return false;
  const mode = decision.mode === 'deny' ? 'deny' : 'warn';
  const entry = {
    gate: mode === 'deny' ? 'ENFORCEMENT_DENY' : 'ENFORCEMENT_WARN',
    hardness: 'AUDIT',
    phase: 'enforcement',
    decision: mode === 'deny' ? 'BLOCKED' : 'WARNED',
    decided_by: decision.hook || 'skill-frontmatter-parser',
    timestamp: new Date().toISOString(),
    detail: String(decision.detail || decision.violation || '').slice(0, 200).replace(/[\n\r]/g, ' '),
    confidence_impact: mode === 'deny' ? -0.1 : -0.05,
  };
  try {
    fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

function isSkillTool(input) {
  const tool = String(input && (input.tool || input.toolName || input.tool_name) || '').toLowerCase();
  return tool === 'skill';
}

function handleToolExecuteBefore(input, output = {}, options = {}) {
  if (!isSkillTool(input) || output.error) return output;
  const projectDir = projectDirFromInput(input, options);
  if (!projectDir) return output;
  const reader = options.findActiveSentinelState || findActiveSentinelState;
  let state;
  try {
    state = reader(projectDir);
  } catch (_) {
    state = CORRUPT_SENTINEL;
  }
  if (!state || state === CORRUPT_SENTINEL || state.pipeline_active !== true) return output;
  const result = enforceSkillContract(state, projectDir);
  if (result.enforced) {
    logEnforcementDecision(projectDir, {
      mode: result.ok ? 'warn' : getEnforcementMode(options.today),
      hook: 'skill-frontmatter-parser',
      pipeline_doc_path: options.pipelineDocPath || options.pipeline_doc_path || state.pipeline_doc_path,
      detail: result.violation || `enforced ${result.skill || 'skill'} checkpoint`,
    });
  }
  if (!result.ok && getEnforcementMode(options.today) === 'deny') {
    output.error = {
      code: 'SKILL_FRONTMATTER_ENFORCEMENT',
      reason: result.violation,
      hint: result.hint,
    };
  }
  return output;
}

function createSkillFrontmatterParserHooks(options = {}) {
  return {
    'tool.execute.before': (input, output = {}) => handleToolExecuteBefore(input, output, options),
  };
}

module.exports = {
  DENY_MODE_START_ISO,
  parseYaml,
  parseFrontmatter,
  readSkillFrontmatter,
  getCurrentSkill,
  getVariantSkill,
  enforceSkillContract,
  getEnforcementMode,
  logEnforcementDecision,
  isSkillTool,
  handleToolExecuteBefore,
  createSkillFrontmatterParserHooks,
};
