'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { validateAgentDirectory } = require('../../src/opencode/agent-validator.cjs');

const root = path.resolve(__dirname, '..', '..');
const coreAgentNames = [
  'pipeline-run-orchestrator',
  'pipeline-information-gate',
  'pipeline-planner',
  'pipeline-pre-tester',
  'pipeline-implementer',
  'pipeline-validator',
  'pipeline-adversarial-security',
  'pipeline-adversarial-architecture',
  'pipeline-adversarial-quality',
];
const typeSpecificAgentNames = [
  'pipeline-bugfix-diagnostic',
  'pipeline-root-cause-analyzer',
  'pipeline-regression-tester',
  'pipeline-feature-implementer',
  'pipeline-integration-validator',
  'pipeline-slice-planner',
  'pipeline-audit-intake',
  'pipeline-domain-analyzer',
  'pipeline-compliance-checker',
  'pipeline-risk-matrix-generator',
  'pipeline-ux-simulator',
  'pipeline-qa-validator',
  'pipeline-accessibility-auditor',
  'pipeline-spec-format-gate',
  'pipeline-content-reviewer',
  'pipeline-adversarial-critic',
  'pipeline-post-impl-validator',
  'pipeline-adversarial-review-coordinator',
  'pipeline-adversarial-architecture-critic',
  'pipeline-adversarial-quality-reviewer',
  'pipeline-adversarial-security-scanner',
];
const result = validateAgentDirectory({
  root,
  agentNames: [...coreAgentNames, ...typeSpecificAgentNames],
});

assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
assert.equal(result.agents.length, 30);

for (const agent of result.agents) {
  assert.equal(agent.mode, 'subagent');
  assert.equal(typeof agent.description, 'string');
  assert.equal(agent.description.length > 0, true);
  assert.equal(agent.body.includes('Role:'), true);
  assert.equal(agent.body.includes('Evidence:'), true);
  const minimumLines = coreAgentNames.includes(agent.name) ? 50 : 34;
  assert.ok(agent.body.split(/\r?\n/).filter((line) => line.trim().length > 0).length >= minimumLines, `${agent.name} prompt is too short`);
  assert.match(agent.body, /OpenCode adaptation/);
  assert.match(agent.body, /structured question gate/i);
  assert.match(agent.body, /structured question gate for safety/i);
  assert.match(agent.body, /structured question gate for scope/i);
  assert.match(agent.body, /structured question gate for TDD/i);
  assert.match(agent.body, /structured question gate for protected/i);
  assert.match(agent.body, /structured question gate for external/i);
  assert.match(agent.body, /acceptance/i);
  assert.match(agent.body, /RED/i);
  assert.match(agent.body, /GREEN/i);
  assert.match(agent.body, /prompt result/i);
  assert.match(agent.body, /review result/i);
  assert.match(agent.body, /final verdict/i);
  assert.match(agent.body, /Claude Code plugin files.*read-only/i);
}

const adversarial = result.agents.filter((agent) => agent.name.includes('adversarial'));
assert.equal(adversarial.length, 8);
for (const agent of adversarial) {
  assert.equal(agent.permission.edit, 'deny');
  assert.equal(agent.permission.bash, 'deny');
}

const implementer = result.agents.find((agent) => agent.name === 'pipeline-implementer');
assert.equal(implementer.permission.edit, 'allow');

console.log('opencode agents OK');
