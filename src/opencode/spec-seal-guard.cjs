'use strict';

const fs = require('node:fs');
const path = require('node:path');

const signer = require('../lib/sentinel-state-signer.cjs');

const BEFORE_HOOK_MARKER = Symbol.for('pipeline-orchestrator.spec-seal.tool.execute.before.processed');
const RUN_SEAL_RE = /run-seal\.cjs/;
const FLAGS_WITH_VALUE = Object.freeze(new Set(['--variant', '--grade', '--manifest', '--run', '--output']));
const SHELL_SEPARATORS = Object.freeze(new Set(['&&', '||', ';', '|']));

function normalizeToolName(toolName) {
  return String(toolName || '').trim().toLowerCase();
}

function commandFromInput(input) {
  const args = (input && (input.args || input.tool_input)) || {};
  return typeof args.command === 'string' ? args.command : '';
}

function shellTokens(text) {
  if (typeof text !== 'string' || !text) return [];
  return text.match(/"[^"]*"|'[^']*'|\S+/g) || [];
}

function stripQuotes(token) {
  if (typeof token !== 'string') return '';
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) return token.slice(1, -1);
  return token;
}

function isRunSealToken(token) {
  const normalized = stripQuotes(token).replace(/\\/g, '/');
  return normalized === 'run-seal.cjs' || normalized.endsWith('/run-seal.cjs');
}

function runSealTokenIndex(tokens) {
  let start = 0;
  for (let i = 0; i <= tokens.length; i += 1) {
    if (i < tokens.length && !SHELL_SEPARATORS.has(stripQuotes(tokens[i]))) continue;
    const command = stripQuotes(tokens[start]).toLowerCase();
    if (command !== 'echo') {
      for (let j = start; j < i; j += 1) {
        if (isRunSealToken(tokens[j])) return j;
      }
    }
    start = i + 1;
  }
  return -1;
}

function runDirAfterToken(tokens, sealIndex) {
  for (let i = sealIndex + 1; i < tokens.length; i += 1) {
    let token = stripQuotes(tokens[i]);
    if (SHELL_SEPARATORS.has(token)) return null;
    if (!token) continue;
    if (token === '--') continue;
    if (token.startsWith('--')) {
      if (FLAGS_WITH_VALUE.has(token) && i + 1 < tokens.length && !stripQuotes(tokens[i + 1]).startsWith('-')) i += 1;
      continue;
    }
    if (token.startsWith('-')) continue;
    if (path.isAbsolute(token)) return token;
  }
  return null;
}

function extractRunDirs(command) {
  if (typeof command !== 'string' || !RUN_SEAL_RE.test(command)) return [];
  const tokens = shellTokens(command);
  const runDirs = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (!isRunSealToken(tokens[i])) continue;
    const runDir = runDirAfterToken(tokens, i);
    if (runDir) runDirs.push(runDir);
  }
  return runDirs;
}

function extractRunDir(command) {
  return extractRunDirs(command)[0] || null;
}

function notesToObject(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function specReviewDone(state) {
  const notes = notesToObject(state && state.notes);
  const options = notes.options;
  return !!(options && typeof options === 'object' && !Array.isArray(options) && options.spec_review_done === true);
}

function readVerifiedSentinel(runDir) {
  try {
    const sentinelPath = path.join(runDir, 'sentinel-state.json');
    if (!fs.existsSync(sentinelPath)) return null;
    const { state, verification } = signer.readVerifiedState(sentinelPath);
    if (!verification || verification.valid !== true) return null;
    return state && typeof state === 'object' && !Array.isArray(state) ? state : null;
  } catch (_) {
    return null;
  }
}

function appendAudit(runDir, reason, nowIso) {
  try {
    const line = JSON.stringify({
      event: 'SPEC_AUTHORING_INCOMPLETE',
      agent: 'spec-seal-guard',
      phase: 'pre-tool',
      detail: String(reason || '').replace(/[\r\n]+/g, ' ').slice(0, 200),
      decided_by: 'spec-seal-guard',
      ts: nowIso || new Date().toISOString(),
    }).replace(/[\r\n]+/g, ' ');
    fs.appendFileSync(path.join(runDir, 'protocol-events.jsonl'), `${line}\n`);
    return true;
  } catch (_) {
    return false;
  }
}

function decideSpecSealGuard(ctx) {
  if (!ctx || typeof ctx !== 'object') return { decision: 'allow' };
  const toolName = normalizeToolName(ctx.toolName);
  if (toolName !== 'bash' && toolName !== 'powershell') return { decision: 'allow' };
  const command = ctx.command;
  if (!RUN_SEAL_RE.test(command)) return { decision: 'allow' };
  const runDirs = extractRunDirs(command);
  if (runDirs.length === 0) return { decision: 'allow' };
  const reader = typeof ctx.readVerifiedSentinel === 'function' ? ctx.readVerifiedSentinel : readVerifiedSentinel;
  for (const runDir of runDirs) {
    const state = ctx.state && runDirs.length === 1 ? ctx.state : reader(runDir);
    if (!state) {
      return {
        decision: 'block',
        code: 'SPEC_AUTHORING_STATE_UNTRUSTED',
        runDir,
        reason: 'SPEC_AUTHORING_STATE_UNTRUSTED: sentinel-state is missing, unreadable, or invalid, so this spec-authoring run cannot be sealed safely.',
      };
    }
    if (!specReviewDone(state)) {
      return {
        decision: 'block',
        code: 'SPEC_AUTHORING_INCOMPLETE',
        runDir,
        reason: 'SPEC_AUTHORING_INCOMPLETE: spec_review_done is not true, so this spec-authoring run cannot be sealed yet.',
      };
    }
  }
  return { decision: 'allow' };
}

function markOnce(target) {
  if (!target || typeof target !== 'object') return true;
  if (target[BEFORE_HOOK_MARKER]) return false;
  Object.defineProperty(target, BEFORE_HOOK_MARKER, { value: true, enumerable: false, configurable: false });
  return true;
}

function gatherContext(input, options = {}) {
  const command = commandFromInput(input);
  return {
    input,
    toolName: input && (input.tool || input.toolName || input.tool_name),
    command,
    readVerifiedSentinel: options.readVerifiedSentinel,
  };
}

function handleToolExecuteBefore(input, output = {}, options = {}) {
  if (!markOnce(output)) return output;
  if (output.error) return output;
  const result = decideSpecSealGuard(gatherContext(input, options));
  if (result.decision === 'block') {
    const auditWriter = typeof options.appendAudit === 'function' ? options.appendAudit : appendAudit;
    const audited = auditWriter(result.runDir, result.reason, options.nowIso);
    if (String(process.env.PIPELINE_SPEC_AUTHORING_ENFORCEMENT || 'deny').trim().toLowerCase() === 'warn') {
      output.warning = { code: result.code, reason: result.reason, runDir: result.runDir, auditFailed: audited === false };
    } else {
      output.error = { code: result.code, reason: result.reason, runDir: result.runDir, auditFailed: audited === false };
    }
  }
  if (typeof options.audit === 'function') options.audit({ type: `spec-seal.${result.decision}`, result });
  return output;
}

function createSpecSealGuardHooks(options = {}) {
  return {
    'tool.execute.before': (input, output = {}) => handleToolExecuteBefore(input, output, options),
  };
}

module.exports = {
  BEFORE_HOOK_MARKER,
  RUN_SEAL_RE,
  normalizeToolName,
  commandFromInput,
  shellTokens,
  isRunSealToken,
  runSealTokenIndex,
  runDirAfterToken,
  extractRunDirs,
  extractRunDir,
  notesToObject,
  specReviewDone,
  readVerifiedSentinel,
  appendAudit,
  gatherContext,
  decideSpecSealGuard,
  handleToolExecuteBefore,
  createSpecSealGuardHooks,
};
