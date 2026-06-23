'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REGISTRY_PATH = path.join(__dirname, '..', '..', 'references', 'entry-points.json');
const PREFIX_RE = /^\/pipeline-orchestrator:([a-z0-9][a-z0-9-]*)/i;

const FALLBACK_ENTRY_POINTS = Object.freeze([
  'pipeline',
  'bugfix', 'bugfix-light', 'bugfix-heavy',
  'feature', 'feature-light', 'feature-heavy',
  'refactor', 'refactor-light', 'refactor-heavy',
  'user-story', 'user-story-light', 'user-story-heavy',
  'audit', 'audit-light', 'audit-heavy',
  'ux-sim', 'ux-sim-light', 'ux-sim-heavy',
  'spec', 'spec-light', 'spec-heavy', 'spec-audit-only',
  'review',
]);
const FALLBACK_ALIASES = Object.freeze({ userstory: 'user-story', ux: 'ux-sim' });

let cache = null;
let fallbackWarned = false;

function buildRegistry(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('entry-point registry must be an object');
  if (!Array.isArray(json.entry_points) || json.entry_points.length === 0) throw new Error('entry-point registry entry_points must be a non-empty array');
  if (json.legacy_aliases != null && (typeof json.legacy_aliases !== 'object' || Array.isArray(json.legacy_aliases))) {
    throw new Error('entry-point registry legacy_aliases must be an object');
  }
  const aliases = json.legacy_aliases || {};
  const names = new Set();
  for (const entry of json.entry_points || []) names.add(String(entry).toLowerCase());
  for (const alias of Object.keys(aliases)) names.add(alias.toLowerCase());
  return { json, names, aliases };
}

function loadRegistry(opts = {}) {
  const useCache = !opts.path;
  if (useCache && cache) return cache;
  const src = opts.path || REGISTRY_PATH;
  let json;
  try {
    json = JSON.parse(fs.readFileSync(src, 'utf8'));
    const registry = buildRegistry(json);
    if (useCache) cache = registry;
    return registry;
  } catch (err) {
    if (!fallbackWarned) {
      fallbackWarned = true;
      process.stderr.write(JSON.stringify({
        audit_event: 'ENTRY_POINTS_REGISTRY_FALLBACK',
        ts: new Date().toISOString(),
        reason: String(err && err.message).slice(0, 120),
      }) + '\n');
    }
    json = { entry_points: FALLBACK_ENTRY_POINTS, legacy_aliases: FALLBACK_ALIASES };
  }
  const registry = buildRegistry(json);
  if (useCache) cache = registry;
  return registry;
}

function detectEntryPoint(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  const match = text.trim().match(PREFIX_RE);
  if (!match) return null;
  const name = match[1].toLowerCase();
  const { names, aliases } = loadRegistry();
  if (!names.has(name)) return null;
  return Object.prototype.hasOwnProperty.call(aliases, name) ? aliases[name] : name;
}

function isPipelineEntryPoint(text) {
  return detectEntryPoint(text) !== null;
}

function entryPointNames() {
  return [...loadRegistry().names];
}

module.exports = {
  detectEntryPoint,
  isPipelineEntryPoint,
  entryPointNames,
  loadRegistry,
  PREFIX_RE,
  REGISTRY_PATH,
  FALLBACK_ENTRY_POINTS,
  FALLBACK_ALIASES,
};
