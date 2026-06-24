'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { validateSkillDirectory } = require('../../src/opencode/skill-validator.cjs');

const root = path.resolve(__dirname, '..', '..');
const result = validateSkillDirectory({
  root,
  skillNames: [
    'pipeline-orchestrator',
    'pipeline-contracts',
    'pipeline-tdd',
    'pipeline-adversarial-review',
  ],
});

assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
assert.equal(result.skills.length, 4);
for (const skill of result.skills) {
  assert.equal(skill.name, skill.folderName);
  assert.match(skill.description, /Use when/);
  assert.match(skill.body, /structured question/i);
  assert.match(skill.body, /reject missing evidence/i);
}

const orchestratorSkill = result.skills.find((skill) => skill.name === 'pipeline-orchestrator');
assert.match(orchestratorSkill.body, /subset/i);
assert.match(orchestratorSkill.body, /not full canonical parity/i);
assert.ok(orchestratorSkill.body.split(/\r?\n/).filter((line) => line.trim().length > 0).length >= 100, 'pipeline-orchestrator skill is too short');
for (const marker of [
  /Phase 0/i,
  /Phase 1/i,
  /Phase 1\.5/i,
  /Phase 2/i,
  /Phase 3/i,
  /Iron Law/i,
  /structured question gate/i,
  /Task/i,
  /acceptance/i,
  /RED/i,
  /GREEN/i,
  /prompt result/i,
  /review result/i,
  /final verdict/i,
  /observer-only/i,
  /PIPELINE_STOP_ATTEMPT/,
  /Evidence Contract/i,
  /Use structured question gate for safety decisions/i,
  /Use structured question gate for scope decisions/i,
  /Use structured question gate for TDD decisions/i,
  /Use structured question gate for protected original file decisions/i,
  /Use structured question gate for external sending decisions/i,
  /Use structured question gate for consent decisions/i,
  /External sending requires explicit consent/i,
  /Original Claude Code plugin files are read-only/i,
]) {
  assert.match(orchestratorSkill.body, marker);
}

console.log('opencode skills OK');
