'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateSentinelState } = require('../validators/contract-validator.cjs');

const SESSION_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_TTL_MINUTES = 60;
const PAIRING_TOLERANCE_MS = 60_000;
const STALE_HEARTBEAT_THRESHOLD_MS = 10 * 60 * 1000;
const HANDSHAKE_TIMEOUT_FLOOR_MS = 60_000;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_HANDSHAKE_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const PENDING_BLOCK_TYPES = new Set(['DISPATCH_REQUEST', 'GATE_REQUEST', 'PLAN_MODE_REQUEST']);

const CORRUPT_SENTINEL = '__CORRUPT_SENTINEL_STATE__';

function normalizeCase(value) {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function realpath(filePath) {
  const read = fs.realpathSync.native || fs.realpathSync;
  return read(filePath);
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
    const base = realpath(current);
    return missingParts.length > 0 ? path.join(base, ...missingParts) : base;
  } catch (_) {
    return resolved;
  }
}

function isSymlink(filePath) {
  try {
    return fs.lstatSync(filePath).isSymbolicLink();
  } catch (_) {
    return false;
  }
}

function containedIn(parent, child) {
  if (isSymlink(path.resolve(parent))) return false;
  const relative = path.relative(resolveForContainment(parent), resolveForContainment(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isTrustedOpenCodeConfigDir(configDir) {
  const base = path.basename(path.resolve(configDir));
  return base === 'opencode' || base === '.opencode';
}

function readValidSentinelState(statePath) {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (_) {
    return { state: null, corrupt: true };
  }

  if (!state || typeof state !== 'object') return { state: null, corrupt: true };

  const validation = validateSentinelState(state);
  if (!validation.ok) return { state: null, corrupt: true };

  return { state, corrupt: false };
}

function resolveHandshakeTimeoutMs() {
  const raw = process.env.PIPELINE_HANDSHAKE_TIMEOUT_MS;
  const n = raw != null ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= HANDSHAKE_TIMEOUT_FLOOR_MS) return Math.min(n, MAX_HANDSHAKE_TIMEOUT_MS);
  if (Number.isFinite(n) && n > 0) return HANDSHAKE_TIMEOUT_FLOOR_MS;
  return DEFAULT_HANDSHAKE_TIMEOUT_MS;
}

function discoverStatePath(projectDir) {
  const pipelineRoot = path.resolve(projectDir, '.pipeline');
  const docsRoot = path.join(pipelineRoot, 'docs');
  const contained = (candidate) => containedIn(pipelineRoot, candidate);

  const docPathEnv = process.env.PIPELINE_DOC_PATH;
  if (typeof docPathEnv === 'string' && docPathEnv.trim()) {
    const resolved = path.resolve(docPathEnv);
    const statePath = path.join(resolved, 'sentinel-state.json');
    if (contained(resolved)) return { statePath, authoritative: true };
  }

  try {
    const pointer = JSON.parse(fs.readFileSync(path.join(pipelineRoot, 'active-run.json'), 'utf8'));
    if (pointer && typeof pointer.pipeline_doc_path === 'string' && contained(pointer.pipeline_doc_path)) {
      const statePath = path.join(path.resolve(pointer.pipeline_doc_path), 'sentinel-state.json');
      return { statePath, authoritative: true };
    }
  } catch (_) {
    // No active-run pointer.
  }

  const runId = process.env.PIPELINE_RUN_ID;
  if (typeof runId === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(runId)) {
    try {
      for (const preDir of fs.readdirSync(docsRoot).filter((name) => /^Pre-.*-action$/.test(name))) {
        const candidate = path.join(docsRoot, preDir, runId, 'sentinel-state.json');
        if (fs.existsSync(candidate) && contained(path.dirname(candidate))) return { statePath: candidate, authoritative: true };
      }
    } catch (_) {
      // No docs root or no matching run.
    }
  }

  const candidates = [];
  try {
    for (const preDir of fs.readdirSync(docsRoot).filter((name) => /^Pre-.*-action$/.test(name))) {
      const preDirPath = path.join(docsRoot, preDir);
      let entries;
      try {
        entries = fs.readdirSync(preDirPath, { withFileTypes: true }).filter((entry) => entry.isDirectory());
      } catch (_) {
        continue;
      }
      for (const entry of entries) {
        const statePath = path.join(preDirPath, entry.name, 'sentinel-state.json');
        try {
          if (!contained(path.dirname(statePath))) continue;
          candidates.push({ statePath, mtime: fs.statSync(statePath).mtimeMs });
        } catch (_) {
          // Ignore missing or unreadable fallback candidates.
        }
      }
    }
  } catch (_) {
    // No docs root.
  }

  candidates.sort((a, b) => b.mtime - a.mtime);
  if (candidates.length > 0) {
    return {
      statePath: candidates[0].statePath,
      authoritative: false,
      fallbackStatePaths: candidates.map((candidate) => candidate.statePath),
    };
  }
  return { statePath: null, authoritative: false };
}

function findActiveSentinelState(projectDir) {
  const { statePath, authoritative, fallbackStatePaths } = discoverStatePath(projectDir);
  if (!statePath) return null;
  const pipelineRoot = path.resolve(projectDir, '.pipeline');

  if (authoritative) {
    if (!containedIn(pipelineRoot, statePath)) return CORRUPT_SENTINEL;
    const result = readValidSentinelState(statePath);
    return result.corrupt ? CORRUPT_SENTINEL : result.state;
  }

  const fallbackStatePath = (fallbackStatePaths || [statePath])[0];
  if (!containedIn(pipelineRoot, fallbackStatePath)) return CORRUPT_SENTINEL;
  const result = readValidSentinelState(fallbackStatePath);
  return result.corrupt ? CORRUPT_SENTINEL : result.state;
}

function findLivePendingBlock(state, timeoutMs = resolveHandshakeTimeoutMs()) {
  if (!state || !Array.isArray(state.pending_blocks)) return null;
  const now = Date.now();
  for (const block of state.pending_blocks) {
    if (!block || typeof block !== 'object') continue;
    if (!PENDING_BLOCK_TYPES.has(block.block_type)) continue;
    const emitted = typeof block.emitted_at === 'string'
      ? Date.parse(block.emitted_at)
      : typeof block.emitted_at === 'number' ? block.emitted_at : NaN;
    if (!Number.isFinite(emitted)) continue;
    if (now - emitted > timeoutMs) continue;
    return block;
  }
  return null;
}

function isInsidePipelineDirs(filePath, projectDir) {
  const normalizedFile = path.resolve(projectDir, filePath);
  const pipelinePath = path.resolve(projectDir, '.pipeline');
  const pipelineRunsPath = path.resolve(projectDir, 'pipeline-runs');
  return containedIn(pipelinePath, normalizedFile) || containedIn(pipelineRunsPath, normalizedFile);
}

function isPlanFile(filePath, projectDir) {
  if (typeof filePath !== 'string' || !filePath) return false;
  let resolved;
  try {
    resolved = path.resolve(filePath);
  } catch (_) {
    return false;
  }
  const candidates = [];
  if (process.env.OPENCODE_CONFIG_DIR && isTrustedOpenCodeConfigDir(process.env.OPENCODE_CONFIG_DIR)) {
    candidates.push(path.resolve(process.env.OPENCODE_CONFIG_DIR, 'plans'));
  }
  try {
    candidates.push(path.resolve(os.homedir(), '.config', 'opencode', 'plans'));
  } catch (_) {
    // Homedir unavailable.
  }
  if (projectDir) candidates.push(path.resolve(projectDir, '.opencode', 'plans'));
  for (const candidate of candidates) {
    if (containedIn(candidate, resolved)) return true;
  }
  return false;
}

function isExemptPath(filePath, projectDir) {
  return isInsidePipelineDirs(filePath, projectDir) || isPlanFile(filePath, projectDir);
}

function getActiveLock(projectDir) {
  const pipelineRoot = path.join(projectDir, '.pipeline');
  const sessionsDir = path.join(projectDir, '.pipeline', 'sessions');
  if (!fs.existsSync(sessionsDir) || !containedIn(pipelineRoot, sessionsDir)) return null;
  const now = Date.now();
  const candidates = [];
  for (const fileName of fs.readdirSync(sessionsDir).filter((name) => name.endsWith('.lock'))) {
    const filePath = path.join(sessionsDir, fileName);
    if (!containedIn(sessionsDir, filePath)) continue;
    try {
      const lock = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (
        typeof lock.session_id === 'string' &&
        SESSION_ID_RE.test(lock.session_id) &&
        typeof lock.expires_at === 'number' &&
        lock.expires_at > now &&
        lock.status === 'active'
      ) {
        if (typeof lock.last_seen_at === 'number' && now - lock.last_seen_at > STALE_HEARTBEAT_THRESHOLD_MS) continue;
        candidates.push(lock);
      }
    } catch (_) {
      // Ignore malformed locks.
    }
  }
  candidates.sort((a, b) => (typeof b.created_at === 'number' ? b.created_at : 0) - (typeof a.created_at === 'number' ? a.created_at : 0));
  return candidates[0] || null;
}

function findPairingEntry(projectDir, sessionId, openedAt) {
  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) return null;
  if (typeof openedAt !== 'number' || !Number.isFinite(openedAt)) return null;

  const pipelineRoot = path.join(projectDir, '.pipeline');
  const docsRoot = path.join(projectDir, '.pipeline', 'docs');
  if (!fs.existsSync(docsRoot) || !containedIn(pipelineRoot, docsRoot)) return null;
  const entries = [];
  try {
    for (const preDir of fs.readdirSync(docsRoot).filter((name) => /^Pre-.*-action$/.test(name))) {
      const preDirPath = path.join(docsRoot, preDir);
      if (!containedIn(docsRoot, preDirPath)) continue;
      let subdirs;
      try {
        subdirs = fs.readdirSync(preDirPath, { withFileTypes: true }).filter((entry) => entry.isDirectory());
      } catch (_) {
        continue;
      }
      for (const subdir of subdirs) {
        const jsonlPath = path.join(preDirPath, subdir.name, 'gate-decisions.jsonl');
        if (!fs.existsSync(jsonlPath) || !containedIn(preDirPath, jsonlPath)) continue;
        for (const line of fs.readFileSync(jsonlPath, 'utf8').split(/\r?\n/)) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (
              entry &&
              (entry.gate === 'EXEC_WINDOW_OPEN' || entry.gate === 'EXEC_WINDOW_CLOSE') &&
              entry.session_id === sessionId &&
              typeof entry.timestamp === 'number' &&
              Number.isFinite(entry.timestamp)
            ) {
              entries.push(entry);
            }
          } catch (_) {
            // Ignore malformed audit lines.
          }
        }
      }
    }
  } catch (_) {
    return null;
  }

  entries.sort((a, b) => a.timestamp - b.timestamp);
  const candidates = entries.filter((entry) => entry.gate === 'EXEC_WINDOW_OPEN' && Math.abs(entry.timestamp - openedAt) <= PAIRING_TOLERANCE_MS);
  return candidates.find((open) => !entries.some((entry) => entry.gate === 'EXEC_WINDOW_CLOSE' && entry.timestamp > open.timestamp && entry.timestamp <= openedAt)) || null;
}

function getActiveExecWindow(projectDir, lockSessionId) {
  if (typeof lockSessionId !== 'string' || !SESSION_ID_RE.test(lockSessionId)) return null;
  const pipelineRoot = path.join(projectDir, '.pipeline');
  const sessionsDir = path.join(projectDir, '.pipeline', 'sessions');
  if (!fs.existsSync(sessionsDir) || !containedIn(pipelineRoot, sessionsDir)) return null;
  const now = Date.now();
  for (const fileName of fs.readdirSync(sessionsDir).filter((name) => name.endsWith('.exec-window'))) {
    const filePath = path.join(sessionsDir, fileName);
    if (!containedIn(sessionsDir, filePath)) continue;
    try {
      const win = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (typeof win.session_id !== 'string' || !SESSION_ID_RE.test(win.session_id) || win.session_id !== lockSessionId) continue;
      const openedAt = fs.statSync(filePath).mtimeMs;
      let ttlMinutes = 5;
      if (typeof win.ttl_minutes === 'number' && Number.isFinite(win.ttl_minutes) && win.ttl_minutes > 0) {
        ttlMinutes = win.ttl_minutes;
      } else if (typeof win.expires_at === 'number' && typeof win.opened_at === 'number' && win.expires_at > win.opened_at) {
        ttlMinutes = (win.expires_at - win.opened_at) / 60000;
      }
      if (ttlMinutes > MAX_TTL_MINUTES) continue;
      const expiresAt = openedAt + ttlMinutes * 60 * 1000;
      if (expiresAt <= now) continue;
      if (!findPairingEntry(projectDir, win.session_id, openedAt) && !(typeof win.opened_at === 'number' && findPairingEntry(projectDir, win.session_id, win.opened_at))) continue;
      return { ...win, opened_at: openedAt, expires_at: expiresAt, ttl_minutes: ttlMinutes };
    } catch (_) {
      // Ignore malformed windows.
    }
  }
  return null;
}

module.exports = {
  CORRUPT_SENTINEL,
  DEFAULT_HANDSHAKE_TIMEOUT_MS,
  HANDSHAKE_TIMEOUT_FLOOR_MS,
  MAX_HANDSHAKE_TIMEOUT_MS,
  MAX_TTL_MINUTES,
  PAIRING_TOLERANCE_MS,
  STALE_HEARTBEAT_THRESHOLD_MS,
  discoverStatePath,
  findActiveSentinelState,
  findLivePendingBlock,
  findPairingEntry,
  getActiveExecWindow,
  getActiveLock,
  isExemptPath,
  isInsidePipelineDirs,
  isPlanFile,
  resolveHandshakeTimeoutMs,
};
