'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  discoverStatePath,
  isExemptPath,
} = require('../state/sentinel-state-inspector.cjs');
const { validateSentinelState } = require('../validators/contract-validator.cjs');

const ARM_TTL_DEFAULT_MS = 30 * 60 * 1000;
const ARM_TTL_FLOOR_MS = 1000;
const BEFORE_HOOK_MARKER = Symbol.for('pipeline-orchestrator.arm-gate.tool.execute.before.processed');

const WORK_TOOLS = Object.freeze(new Set([
  'edit', 'write', 'bash', 'powershell',
  'task', 'skill', 'customtool', 'custom-tool',
  'multiedit', 'multi_edit', 'notebookedit', 'notebook_edit',
]));

const FILE_WRITE_TOOLS = Object.freeze(new Set([
  'edit', 'write', 'multiedit', 'multi_edit', 'notebookedit', 'notebook_edit',
]));

const ALWAYS_ALLOW_TOOLS = Object.freeze(new Set([
  'read', 'grep', 'glob', 'question', 'todowrite',
  'plan', 'exitplanmode', 'enterplanmode',
]));

function normalizeToolName(toolName) {
  return String(toolName || '').trim().toLowerCase();
}

function realpath(value) {
  return fs.realpathSync.native ? fs.realpathSync.native(value) : fs.realpathSync(value);
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function pipelineDir(projectDir) {
  const root = realpath(projectDir);
  const dir = path.join(projectDir, '.pipeline');
  if (!fs.existsSync(dir)) return null;
  const resolved = realpath(dir);
  return isInside(root, resolved) ? resolved : null;
}

function armMarkerPath(projectDir) {
  const dir = pipelineDir(projectDir);
  return dir ? path.join(dir, 'pipeline-arm-pending.json') : null;
}

function resolveArmTtlMs() {
  const raw = Number(process.env.PIPELINE_ARM_TTL_MS);
  if (Number.isFinite(raw) && raw >= ARM_TTL_FLOOR_MS) return raw;
  return ARM_TTL_DEFAULT_MS;
}

function markerWorkflow(marker, fallbackTimestampMs) {
  let malformed = false;
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) malformed = true;
  let ts = Number.isFinite(fallbackTimestampMs) ? fallbackTimestampMs : NaN;
  if (!malformed && Object.prototype.hasOwnProperty.call(marker, 'requested_at')) {
    const parsed = Date.parse(marker.requested_at);
    if (Number.isFinite(parsed)) ts = parsed;
    else malformed = true;
  } else {
    malformed = true;
  }
  if (!Number.isFinite(ts)) return null;
  if (Date.now() - ts > resolveArmTtlMs()) return null;
  return {
    workflow: !malformed && typeof marker.workflow === 'string' ? marker.workflow : undefined,
    malformed,
  };
}

function readArmPending(projectDir) {
  try {
    if (typeof projectDir !== 'string' || !projectDir) return null;
    const marker = armMarkerPath(projectDir);
    if (!marker) return null;
    let stat;
    try {
      stat = fs.statSync(marker);
    } catch (err) {
      if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return null;
      return markerWorkflow(null, Date.now());
    }
    try {
      const markerReal = realpath(marker);
      if (!isInside(path.dirname(marker), markerReal)) return markerWorkflow(null, stat.mtimeMs);
      return markerWorkflow(JSON.parse(fs.readFileSync(markerReal, 'utf8')), stat.mtimeMs);
    } catch {
      return markerWorkflow(null, stat.mtimeMs);
    }
  } catch {
    return null;
  }
}

function sanitizeWorkflow(workflow) {
  if (typeof workflow !== 'string') return '';
  return workflow
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[^A-Za-z0-9 _.:/-]/g, '')
    .trim()
    .slice(0, 80);
}

function buildArmReason(toolName, workflow) {
  const safeWorkflow = sanitizeWorkflow(workflow);
  const suffix = safeWorkflow ? ` (workflow detectado: ${safeWorkflow})` : '';
  return `PIPELINE_NOT_ARMED: você invocou o Pipeline Orchestrator${suffix}, mas NENHUM run foi armado. `
    + `Não conduza o trabalho como conversa avulsa. Antes de qualquer trabalho real, arme o run em .pipeline ou inicie um agente pipeline. `
    + `A ferramenta '${toolName || '(desconhecida)'}' fica bloqueada até o run existir. Leitura e perguntas seguem liberadas.`;
}

function isPipelineTarget(input) {
  const tool = normalizeToolName(input && (input.tool || input.toolName || input.tool_name));
  const args = (input && (input.args || input.tool_input)) || {};
  if (tool === 'task') {
    const agent = args.agentName || args.agent || '';
    return typeof agent === 'string' && (agent.startsWith('pipeline-') || agent.startsWith('pipeline:') || agent.startsWith('pipeline-orchestrator'));
  }
  if (tool === 'skill') {
    const skill = args.name || args.skill || '';
    return typeof skill === 'string' && skill.startsWith('pipeline');
  }
  return false;
}

function isPipelineDocWrite(input, projectDir) {
  const tool = normalizeToolName(input && (input.tool || input.toolName || input.tool_name));
  if (!FILE_WRITE_TOOLS.has(tool)) return false;
  const args = (input && (input.args || input.tool_input)) || {};
  const raw = args.filePath || args.file_path || args.path;
  if (typeof raw !== 'string' || !raw) return false;
  const target = path.isAbsolute(raw) ? raw : path.resolve(projectDir, raw);
  try {
    const pipelineRoot = path.resolve(projectDir, '.pipeline');
    const logicalRelative = path.relative(pipelineRoot, path.resolve(target));
    if (logicalRelative.startsWith('..') || path.isAbsolute(logicalRelative)) return false;
    return pipelineDir(projectDir) !== null && isExemptPath(target, projectDir);
  } catch { return false; }
}

function isRunActive(projectDir) {
  let discovery;
  try { discovery = discoverStatePath(projectDir); } catch { return false; }
  if (!discovery || !discovery.authoritative || !discovery.statePath) return false;
  try {
    const state = JSON.parse(fs.readFileSync(discovery.statePath, 'utf8'));
    const validation = validateSentinelState(state);
    if (!validation.ok) return false;
    return state.pipeline_active === true;
  } catch {
    return false;
  }
}

function decideArmGate(ctx) {
  if (!ctx || typeof ctx !== 'object') return { decision: 'allow' };
  if (!ctx.armPending) return { decision: 'allow' };
  if (ctx.runActive) return { decision: 'allow' };

  const toolName = normalizeToolName(ctx.toolName);
  if (ALWAYS_ALLOW_TOOLS.has(toolName)) return { decision: 'allow' };
  if (ctx.pipelineAligned) return { decision: 'allow' };

  return {
    decision: 'block',
    code: 'PIPELINE_NOT_ARMED',
    reason: buildArmReason(toolName, ctx.workflow),
  };
}

function gatherContext(input, options = {}) {
  if (!input || typeof input !== 'object') return null;
  const projectDir = typeof options.projectDir === 'function'
    ? options.projectDir(input)
    : options.projectDir || input.cwd || process.cwd();
  if (typeof projectDir !== 'string' || !projectDir) return null;
  const marker = readArmPending(projectDir);
  if (!marker) return { toolName: input.tool || input.toolName || input.tool_name, armPending: false };
  return {
    toolName: input.tool || input.toolName || input.tool_name,
    armPending: true,
    runActive: isRunActive(projectDir),
    pipelineAligned: isPipelineTarget(input) || isPipelineDocWrite(input, projectDir),
    enforce: options.enforce,
    workflow: marker.workflow,
  };
}

function markOnce(target) {
  if (!target || typeof target !== 'object') return true;
  if (target[BEFORE_HOOK_MARKER]) return false;
  Object.defineProperty(target, BEFORE_HOOK_MARKER, { value: true, enumerable: false, configurable: false });
  return true;
}

function handleToolExecuteBefore(input, output = {}, options = {}) {
  if (!markOnce(output)) return output;
  const result = decideArmGate(gatherContext(input, options));
  if (result.decision === 'block') {
    output.error = { code: result.code, reason: result.reason };
  } else if (result.warn) {
    output.warning = { code: result.code, reason: 'Pipeline arm gate is in warn mode.' };
  }
  if (typeof options.audit === 'function') options.audit({ type: `pipeline-arm.${result.decision}`, result });
  return output;
}

function createPipelineArmGateHooks(options = {}) {
  return {
    'tool.execute.before': (input, output = {}) => handleToolExecuteBefore(input, output, options),
  };
}

module.exports = {
  ARM_TTL_DEFAULT_MS,
  ARM_TTL_FLOOR_MS,
  WORK_TOOLS,
  FILE_WRITE_TOOLS,
  ALWAYS_ALLOW_TOOLS,
  BEFORE_HOOK_MARKER,
  armMarkerPath,
  readArmPending,
  resolveArmTtlMs,
  sanitizeWorkflow,
  buildArmReason,
  isPipelineTarget,
  isPipelineDocWrite,
  isRunActive,
  gatherContext,
  decideArmGate,
  handleToolExecuteBefore,
  createPipelineArmGateHooks,
};
