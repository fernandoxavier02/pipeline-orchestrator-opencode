'use strict';

const path = require('node:path');

const MAX_LEN = 2000;
const TRUNCATE_TO = MAX_LEN - 3;
const MAX_PLUGIN_ROOT_LEN = 4096;
const MIN_ENV_VALUE_LEN = 8;
const ENV_KEY_PATTERN = /(SECRET|TOKEN|KEY|PASSWORD)/i;
const SECRET_PATTERNS = Object.freeze([
  /sk_live_[A-Za-z0-9]+/g,
  /sk_test_[A-Za-z0-9]+/g,
  /sk-[A-Za-z0-9_-]{10,}/g,
  /ghp_[A-Za-z0-9]+/g,
  /github_pat_[A-Za-z0-9_]+/g,
  /npm_[A-Za-z0-9_-]+/g,
  /pk-lf-[a-z0-9-]+/gi,
  /sk-lf-[a-z0-9-]+/gi,
  /sk-ant-api[0-9]+-[A-Za-z0-9_-]{30,}/g,
  /sk-ant-[A-Za-z0-9_-]{40,}/g,
  /Bearer\s+[A-Za-z0-9+/=._-]+/gi,
  /LANGFUSE_SECRET_KEY=\S+/g,
  /AKIA[0-9A-Z]{16}/g,
  /(xox[abprs])-[A-Za-z0-9-]+/g,
  /\b(password|api[_-]?key|secret|token)\s*[:=]\s*[^\s,;]+/gi,
]);

let envSecretsCache = null;
let envSignature = '';

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
}

function truncate(value) {
  const text = value == null ? '' : String(value);
  return text.length > MAX_LEN ? `${text.slice(0, TRUNCATE_TO)}...` : text;
}

function redactPaths(text, pluginRoot) {
  if (!text) return text;
  let result = text;
  const normalizedRoot = typeof pluginRoot === 'string' ? pluginRoot.replace(/\\/g, '/').replace(/\/+$/, '') : '';
  if (normalizedRoot) {
    const escapedRoot = escapeRegExp(normalizedRoot).replace(/\//g, '[\\\\/]');
    result = result.replace(new RegExp(`${escapedRoot}[\\\\/][\\w\-./\\\\]+`, 'gi'), (match) => {
      const normalized = match.replace(/\\/g, '/');
      return normalized.slice(normalizedRoot.length + 1);
    });
    result = result.replace(new RegExp(escapedRoot, 'gi'), '<plugin-root>');
  }
  result = result.replace(/[A-Za-z]:[\\/][\w\-./\\]+/g, '<external-path>');
  result = result.replace(/(?:^|[\s"'`(])(\/(?:[\w.\-]+\/)+[\w.\-]+)/g, (match, found) => match.replace(found, '<external-path>'));
  return result;
}

function computeEnvSignature() {
  return Object.keys(process.env)
    .filter((key) => ENV_KEY_PATTERN.test(key) && process.env[key])
    .map((key) => `${key}:${process.env[key].length}`)
    .sort()
    .join(',');
}

function envSecrets() {
  const signature = computeEnvSignature();
  if (envSecretsCache !== null && signature === envSignature) return envSecretsCache;
  envSignature = signature;
  envSecretsCache = Object.keys(process.env)
    .filter((key) => ENV_KEY_PATTERN.test(key))
    .map((key) => process.env[key])
    .filter((value) => typeof value === 'string' && value.length > MIN_ENV_VALUE_LEN);
  return envSecretsCache;
}

function redactSecrets(text) {
  if (!text) return text;
  let result = text;
  for (const pattern of SECRET_PATTERNS) result = result.replace(pattern, (match, key) => (key ? `${key}=[REDACTED]` : '[REDACTED]'));
  for (const secret of envSecrets()) {
    if (result.includes(secret)) result = result.replaceAll(secret, '[REDACTED]');
  }
  return result;
}

function sanitizeSpanPayload(text, pluginRoot) {
  if (text == null) return '';
  const validRoot = typeof pluginRoot === 'string' && pluginRoot.length > 0 && pluginRoot.length <= MAX_PLUGIN_ROOT_LEN ? path.resolve(pluginRoot) : null;
  let result = truncate(text);
  if (validRoot) result = redactPaths(result, validRoot);
  return redactSecrets(result);
}

function sanitizeAny(value, pluginRoot, depth = 0) {
  if (depth > 32) return '<max-depth>';
  if (value == null) return value;
  if (typeof value === 'string') return sanitizeSpanPayload(value, pluginRoot);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeAny(item, pluginRoot, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).map((key) => [key, sanitizeAny(value[key], pluginRoot, depth + 1)]));
  }
  return sanitizeSpanPayload(String(value), pluginRoot);
}

module.exports = {
  sanitizeSpanPayload,
  sanitizeAny,
};
