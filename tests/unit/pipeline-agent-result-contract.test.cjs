'use strict';

const assert = require('node:assert/strict');

const contract = require('../../src/lib/contracts/pipeline-agent-result.cjs');

function block(body) {
  return `${contract.BEGIN}\n${body}\n${contract.END}`;
}

assert.equal(contract.BEGIN, '=== PIPELINE_AGENT_RESULT_V1 ===');
assert.equal(contract.END, '=== END PIPELINE_AGENT_RESULT_V1 ===');
assert.equal(contract.MAX_BODY_BYTES, 64 * 1024);
assert.deepEqual([...contract.VALID_STATUS], ['completed', 'awaiting_user_gate', 'failed']);
assert.equal(contract.VALID_STATUS.size, 3);
assert.throws(() => contract.VALID_STATUS.add('resolved'), TypeError);
assert.deepEqual(contract.KNOWN_KEYS, {
  status: 'string',
  summary: 'string',
  next_agent: 'string',
  findings: 'array',
  evidence: 'array',
  reason: 'string',
  detail: 'string',
  metrics: 'object',
  blocking: 'boolean',
});
assert.equal(Object.isFrozen(contract.KNOWN_KEYS), true);

let result = contract.parseResultBlock(block(JSON.stringify({
  status: 'completed',
  summary: 'done',
  findings: [],
  evidence: [],
  metrics: {},
  blocking: false,
})));
assert.equal(result.ok, true);
assert.equal(result.status, 'completed');
assert.equal(result.summary, 'done');

result = contract.parseResultBlock(`${block(JSON.stringify({ status: 'failed', reason: 'old' }))}\n${block(JSON.stringify({ status: 'awaiting_user_gate', next_agent: 'information-gate' }))}`);
assert.equal(result.ok, true);
assert.equal(result.status, 'awaiting_user_gate');
assert.equal(result.next_agent, 'information-gate');

assert.equal(contract.parseResultBlock('').ok, false);
assert.match(contract.parseResultBlock('').error, /absence is never success/);
assert.equal(contract.parseResultBlock('no block here').ok, false);
assert.equal(contract.parseResultBlock(block('status: completed')).ok, false);
assert.match(contract.parseResultBlock(block('{"status":"completed","status":"failed"}')).error, /duplicate JSON key/);
assert.match(contract.parseResultBlock(block('{"\\u0073tatus":"failed","status":"completed"}')).error, /duplicate JSON key/);
assert.match(contract.parseResultBlock(block(JSON.stringify({ status: 'completed', extra: true }))).error, /unknown governance key/);
assert.match(contract.parseResultBlock(block(JSON.stringify({ status: 'resolved' }))).error, /outside the closed vocabulary/);
assert.match(contract.parseResultBlock(block(JSON.stringify({ status: 'completed', findings: {} }))).error, /wrong type/);
assert.equal(contract.parseResultBlock(block(JSON.stringify({ status: 'failed', reason: 'real failure' }))).ok, true);
assert.equal(contract.parseResultBlock(block(JSON.stringify({ status: 'failed', reason: 'real failure' }))).status, 'failed');

const oversized = `${contract.BEGIN}\n${'x'.repeat(contract.MAX_BODY_BYTES + 1)}\n${contract.END}`;
assert.equal(contract.parseResultBlock(oversized).ok, false);
assert.match(contract.parseResultBlock(oversized).error, /exceeds size limit/);

const originalSetHas = Set.prototype.has;
try {
  Set.prototype.has = () => true;
  assert.equal(contract.parseResultBlock(block(JSON.stringify({ status: 'resolved' }))).ok, false);
} finally {
  Set.prototype.has = originalSetHas;
}

try {
  Set.prototype.injectInvalidStatus = function injectInvalidStatus() {
    this.add('resolved');
  };
  assert.equal(typeof contract.VALID_STATUS.injectInvalidStatus, 'undefined');
} finally {
  delete Set.prototype.injectInvalidStatus;
}

console.log('pipeline agent result contract OK');
