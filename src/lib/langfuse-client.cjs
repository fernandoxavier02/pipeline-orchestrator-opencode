'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sanitizeAny, sanitizeSpanPayload } = require('./langfuse-sanitizer.cjs');

const DEFAULT_HOST = 'https://cloud.langfuse.com';
const ERROR_LOG_PATH = path.join('.pipeline', 'langfuse-errors.jsonl');
const ERROR_MESSAGE_MAX = 200;
const ALLOWED_ERROR_TYPES = Object.freeze([
  'sdk_throw',
  'missing_credentials',
  'tmp_file_corrupt',
  'flush_timeout',
  'invalid_sample_rate',
  'network_error',
  'unknown',
]);

let client = null;
let enabledMemo = null;
let sampleRateMemo = null;
let missingCredsLogged = false;
let invalidRateLogged = false;
let disabledForSession = false;
let pluginRootWarningEmitted = false;
let invalidHostLogged = false;

function envVar(name) {
  return process.env[name];
}

function isEnabled() {
  if (disabledForSession) return false;
  if (enabledMemo !== null) return enabledMemo;
  const flag = String(envVar('LANGFUSE_ENABLED') || '').trim().toLowerCase();
  if (flag !== 'true' && flag !== '1') {
    enabledMemo = false;
    return false;
  }
  if (!envVar('LANGFUSE_PUBLIC_KEY') || !envVar('LANGFUSE_SECRET_KEY')) {
    if (!missingCredsLogged) {
      logError('missing_credentials', 'LANGFUSE_ENABLED is set but PUBLIC/SECRET key missing', { hook_name: 'langfuse-client' });
      missingCredsLogged = true;
    }
    disabledForSession = true;
    enabledMemo = false;
    return false;
  }
  enabledMemo = true;
  return true;
}

function getSampleRate() {
  if (sampleRateMemo !== null) return sampleRateMemo;
  const raw = envVar('LANGFUSE_SAMPLE_RATE');
  if (raw == null || raw === '') {
    sampleRateMemo = 1;
    return sampleRateMemo;
  }
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    if (!invalidRateLogged) {
      logError('invalid_sample_rate', `LANGFUSE_SAMPLE_RATE=${raw} out of range; using 1.0`, { hook_name: 'langfuse-client' });
      invalidRateLogged = true;
    }
    sampleRateMemo = 1;
    return sampleRateMemo;
  }
  sampleRateMemo = parsed;
  return sampleRateMemo;
}

function initializeForSession() {
  return { enabled: isEnabled(), sampleRate: getSampleRate() };
}

function validHost(rawHost) {
  if (!rawHost) return DEFAULT_HOST;
  if (/^https:\/\//.test(rawHost) || /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(rawHost)) return rawHost;
  if (!invalidHostLogged) {
    logError('network_error', 'LANGFUSE_HOST must use https:// scheme; falling back to default', { hook_name: 'langfuse-client' });
    invalidHostLogged = true;
  }
  return DEFAULT_HOST;
}

function getClient() {
  if (!isEnabled()) return null;
  if (client) return client;
  let LangfuseSdk;
  try {
    const sdkModuleId = 'langfuse';
    LangfuseSdk = require(sdkModuleId);
  } catch (err) {
    logError('sdk_throw', `require('langfuse') failed: ${err && err.message}`, { hook_name: 'langfuse-client' });
    disabledForSession = true;
    enabledMemo = false;
    return null;
  }
  const Ctor = LangfuseSdk.Langfuse || LangfuseSdk.default || LangfuseSdk;
  try {
    client = new Ctor({
      publicKey: envVar('LANGFUSE_PUBLIC_KEY'),
      secretKey: envVar('LANGFUSE_SECRET_KEY'),
      baseUrl: validHost(envVar('LANGFUSE_HOST')),
    });
    return client;
  } catch (err) {
    logError('sdk_throw', `Langfuse constructor threw: ${err && err.message}`, { hook_name: 'langfuse-client' });
    disabledForSession = true;
    enabledMemo = false;
    return null;
  }
}

function resolvePluginRoot() {
  const raw = process.env.OPENCODE_PLUGIN_ROOT || process.env.CLAUDE_PLUGIN_ROOT;
  return typeof raw === 'string' && raw.length > 0 && raw.length <= 4096 ? raw : undefined;
}

function logError(errorType, message, opts = {}) {
  try {
    const pluginRoot = resolvePluginRoot();
    if (!pluginRoot) {
      if (!pluginRootWarningEmitted) pluginRootWarningEmitted = true;
      return;
    }
    const safeType = ALLOWED_ERROR_TYPES.includes(errorType) ? errorType : 'unknown';
    let safeMessage = sanitizeSpanPayload(message || '', pluginRoot);
    if (safeMessage.length > ERROR_MESSAGE_MAX) safeMessage = sanitizeSpanPayload(`${safeMessage.slice(0, ERROR_MESSAGE_MAX - 3)}...`, pluginRoot);
    const entry = sanitizeAny({
      timestamp: new Date().toISOString(),
      error_type: safeType,
      message_truncated: safeMessage,
      run_id: opts.run_id || process.env.PIPELINE_RUN_ID || null,
      hook_name: opts.hook_name || 'langfuse-client',
    }, pluginRoot);
    const logPath = path.join(pluginRoot, ERROR_LOG_PATH);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (_) {
    // Observability failures must never affect the pipeline.
  }
}

function resetForTests() {
  if (process.env.PIPELINE_TEST !== 'true' && process.env.NODE_ENV !== 'test') {
    throw new Error('_resetForTests called outside test environment');
  }
  client = null;
  enabledMemo = null;
  sampleRateMemo = null;
  missingCredsLogged = false;
  invalidRateLogged = false;
  disabledForSession = false;
  pluginRootWarningEmitted = false;
  invalidHostLogged = false;
}

module.exports = {
  isEnabled,
  initializeForSession,
  getClient,
  getSampleRate,
  logError,
  ALLOWED_ERROR_TYPES,
  ERROR_LOG_PATH,
  DEFAULT_HOST,
};

if (process.env.PIPELINE_TEST === 'true' || process.env.NODE_ENV === 'test') {
  module.exports._resetForTests = resetForTests;
  module.exports.__UNSAFE_resetForTests_TEST_ONLY = resetForTests;
}
