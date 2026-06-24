'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateSkillDirectory } = require('../../src/opencode/skill-validator.cjs');

const root = path.resolve(__dirname, '..', '..');
const modeSkillNames = [
  'bugfix-light',
  'bugfix-heavy',
  'feature-light',
  'feature-heavy',
  'audit-light',
  'audit-heavy',
  'ux-sim-light',
  'ux-sim-heavy',
  'spec-light',
  'spec-heavy',
];
const expectedModeStepCounts = {
  'bugfix-light': 8,
  'bugfix-heavy': 11,
  'feature-light': 13,
  'feature-heavy': 13,
  'audit-light': 9,
  'audit-heavy': 9,
  'ux-sim-light': 5,
  'ux-sim-heavy': 7,
  'spec-light': 6,
  'spec-heavy': 9,
};
const result = validateSkillDirectory({
  root,
  skillNames: [
    'pipeline-orchestrator',
    'pipeline-contracts',
    'pipeline-tdd',
    'pipeline-adversarial-review',
    ...modeSkillNames,
  ],
});

assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
assert.equal(result.skills.length, 14);
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

for (const skillName of modeSkillNames) {
  const skill = result.skills.find((item) => item.name === skillName);
  assert.ok(skill, `${skillName} was not loaded`);
  assert.match(skill.body, /local OpenCode adaptation/i);
  assert.match(skill.body, /sequence/i);
  assert.match(skill.body, /AskUserQuestion|structured question gate/i);
  assert.doesNotMatch(skill.body, /AskUserQuestion/);
  assert.match(skill.body, /untrusted/i);
  assert.match(skill.body, /acceptance/i);
  assert.match(skill.body, /RED/i);
  assert.match(skill.body, /GREEN/i);
  assert.match(skill.body, /prompt result/i);
  assert.match(skill.body, /review result/i);
  assert.match(skill.body, /final verdict/i);
  assert.match(skill.body, /Original Claude Code plugin files are read-only/i);

  const startMatch = skill.body.match(/Start with `steps\/([^`]+)`/);
  assert.ok(startMatch, `${skillName} start step reference missing`);

  const stepsDir = path.join(root, '.opencode', 'skills', skillName, 'steps');
  assert.equal(fs.existsSync(stepsDir), true, `${skillName} steps directory missing`);
  const stepFiles = fs.readdirSync(stepsDir).filter((entry) => /^\d{2}-.+\.md$/.test(entry));
  assert.equal(stepFiles.length, expectedModeStepCounts[skillName], `${skillName} step count mismatch`);
  assert.ok(stepFiles.includes(startMatch[1]), `${skillName} start step missing`);
  for (const stepFile of stepFiles) {
    const stepBody = fs.readFileSync(path.join(stepsDir, stepFile), 'utf8');
    assert.match(stepBody, /expected_next|final verdict/i, `${skillName}/${stepFile} missing transition contract`);
    assert.match(stepBody, /evidence/i, `${skillName}/${stepFile} missing evidence contract`);
  }
}

console.log('opencode skills OK');
