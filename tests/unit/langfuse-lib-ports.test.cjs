'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sanitizer = require('../../src/lib/langfuse-sanitizer.cjs');
const carrier = require('../../src/lib/langfuse-carrier.cjs');

const originalEnv = {
  LANGFUSE_ENABLED: process.env.LANGFUSE_ENABLED,
  LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY,
  LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY,
  LANGFUSE_SAMPLE_RATE: process.env.LANGFUSE_SAMPLE_RATE,
  LANGFUSE_FORCE_PPID: process.env.LANGFUSE_FORCE_PPID,
  PIPELINE_RUN_ID: process.env.PIPELINE_RUN_ID,
  PIPELINE_DOC_PATH: process.env.PIPELINE_DOC_PATH,
  PIPELINE_TEST: process.env.PIPELINE_TEST,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

try {
  process.env.PIPELINE_TEST = 'true';
  delete process.env.LANGFUSE_ENABLED;
  delete process.env.LANGFUSE_PUBLIC_KEY;
  delete process.env.LANGFUSE_SECRET_KEY;
  delete process.env.LANGFUSE_SAMPLE_RATE;
  delete process.env.PIPELINE_RUN_ID;
  delete process.env.PIPELINE_DOC_PATH;

  const client = require('../../src/lib/langfuse-client.cjs');
  if (typeof client._resetForTests === 'function') client._resetForTests();

  assert.equal(typeof sanitizer.sanitizeSpanPayload, 'function');
  assert.equal(typeof sanitizer.sanitizeAny, 'function');
  assert.equal(typeof carrier.getSpanPath, 'function');
  assert.equal(typeof carrier.getTracePath, 'function');
  assert.equal(typeof carrier.writeTraceCarrier, 'function');
  assert.equal(typeof carrier.readTraceCarrier, 'function');
  assert.equal(typeof carrier.cleanupTracePath, 'function');
  assert.equal(typeof carrier.cleanupSpanPath, 'function');
  assert.equal(typeof carrier.resolvePpid, 'function');
  assert.equal(typeof carrier.readTraceCarrierForCurrentProcess, 'function');
  assert.equal(typeof client.isEnabled, 'function');
  assert.equal(typeof client.initializeForSession, 'function');
  assert.equal(typeof client.getClient, 'function');
  assert.equal(typeof client.getSampleRate, 'function');
  assert.equal(typeof client.logError, 'function');

  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w6-3-root-'));
  const fakeSecret = 'sk-' + 'abcdefghijkl';
  const sanitized = sanitizer.sanitizeSpanPayload(`password=abc123 ${fakeSecret} ${path.join(projectRoot, 'src', 'x.js')}`, projectRoot);
  assert.match(sanitized, /password=\[REDACTED\]/);
  assert.match(sanitized, /\[REDACTED\]/);
  assert.equal(sanitized.includes(projectRoot), false);

  const nested = { token: fakeSecret, items: [`${projectRoot}${path.sep}secret.txt`] };
  const cloned = sanitizer.sanitizeAny(nested, projectRoot);
  assert.notEqual(cloned, nested);
  assert.equal(JSON.stringify(cloned).includes(fakeSecret), false);
  assert.equal(JSON.stringify(nested).includes(fakeSecret), true);

  process.env.LANGFUSE_FORCE_PPID = '4242';
  const spanPath = carrier.getSpanPath('run-lib', 1);
  const tracePath = carrier.getTracePath('run-lib', 1);
  assert.equal(path.dirname(spanPath), os.tmpdir());
  assert.equal(path.basename(spanPath).startsWith('langfuse-span-'), true);
  assert.equal(path.basename(tracePath).startsWith('langfuse-trace-'), true);
  carrier.cleanupTracePath('run-lib', 1);
  carrier.writeTraceCarrier('run-lib', 1, { traceId: 'trace-lib', runId: 'run-lib' });
  assert.equal(carrier.readTraceCarrier('run-lib', 1).traceId, 'trace-lib');
  const precreatedTracePath = carrier.getTracePath('run-precreated', 1);
  carrier.cleanupTracePath('run-precreated', 1);
  fs.writeFileSync(precreatedTracePath, JSON.stringify({ traceId: 'forged' }), { flag: 'w' });
  assert.equal(carrier.writeTraceCarrier('run-precreated', 1, { traceId: 'real' }), false);
  assert.equal(carrier.readTraceCarrier('run-precreated', 1).traceId, 'forged');
  carrier.cleanupTracePath('run-precreated', 1);
  assert.equal(carrier.readTraceCarrierForCurrentProcess(), null);
  process.env.PIPELINE_RUN_ID = 'run-lib';
  assert.equal(carrier.readTraceCarrierForCurrentProcess().traceId, 'trace-lib');
  carrier.cleanupTracePath('run-lib', 1);
  assert.equal(carrier.readTraceCarrier('run-lib', 1), null);

  assert.equal(client.isEnabled(), false);
  assert.deepEqual(client.initializeForSession(), { enabled: false, sampleRate: 1 });
  assert.equal(client.getClient(), null);
  process.env.LANGFUSE_SAMPLE_RATE = 'bad';
  if (typeof client._resetForTests === 'function') client._resetForTests();
  assert.equal(client.getSampleRate(), 1);
  process.env.LANGFUSE_ENABLED = 'true';
  delete process.env.LANGFUSE_PUBLIC_KEY;
  delete process.env.LANGFUSE_SECRET_KEY;
  if (typeof client._resetForTests === 'function') client._resetForTests();
  assert.equal(client.isEnabled(), false);
  assert.equal(client.getClient(), null);

  console.log('langfuse lib ports OK');
} finally {
  restoreEnv();
}
