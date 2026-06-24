'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const parser = require('../../src/opencode/skill-frontmatter-parser.cjs');
const plugin = require('../../src/opencode/pipeline-adaptation-plugin.cjs');
const opencodeIndex = require('../../src/opencode/index.cjs');

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

const yaml = parser.parseYaml(`
name: pipeline-orchestrator
enabled: true
step: 7
threshold: 0.5
__proto__: polluted
sentinel_checkpoints: [7, pre_8]
gates_at:
  - 3
  - 7
contract:
  owner: controller
  required: true
agents:
  - { name: planner, type: pipeline-planner }
`);

assert.equal(yaml.name, 'pipeline-orchestrator');
assert.equal(yaml.enabled, true);
assert.equal(yaml.step, 7);
assert.equal(yaml.threshold, 0.5);
assert.deepEqual(yaml.sentinel_checkpoints, [7, 'pre_8']);
assert.deepEqual(yaml.gates_at, [3, 7]);
assert.equal(yaml.contract.owner, 'controller');
assert.equal(yaml.contract.required, true);
assert.deepEqual(yaml.agents, [{ name: 'planner', type: 'pipeline-planner' }]);
assert.equal({}.polluted, undefined);

const frontmatter = parser.parseFrontmatter(`---
current_skill: feature-light
sentinel_checkpoints:
  - 7
  - pre_8
---
# Body
`);
assert.equal(frontmatter.ok, true);
assert.deepEqual(frontmatter.frontmatter.sentinel_checkpoints, [7, 'pre_8']);

assert.equal(parser.parseFrontmatter('# no frontmatter').ok, false);
assert.equal(parser.parseFrontmatter(null).ok, false);

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w8-6-frontmatter-'));
write(path.join(repoRoot, 'skills', 'feature-light', 'SKILL.md'), `---
current_skill: feature-light
sentinel_checkpoints: [7, pre_8]
---
# Feature Light
`);

const skill = parser.readSkillFrontmatter('feature-light', repoRoot);
assert.equal(skill.ok, true);
assert.equal(skill.frontmatter.current_skill, 'feature-light');
assert.equal(skill.source, path.join(repoRoot, 'skills', 'feature-light', 'SKILL.md'));

write(path.join(repoRoot, '.opencode', 'skills', 'opencode-skill', 'SKILL.md'), `---
current_skill: opencode-skill
sentinel_checkpoints: [1]
---
# OpenCode Skill
`);
const opencodeSkill = parser.readSkillFrontmatter('opencode-skill', repoRoot);
assert.equal(opencodeSkill.ok, true);
assert.equal(opencodeSkill.source, path.join(repoRoot, '.opencode', 'skills', 'opencode-skill', 'SKILL.md'));

const escaped = parser.readSkillFrontmatter('../outside', repoRoot);
assert.equal(escaped.ok, false);
assert.match(escaped.error, /invalid skill name/);

const missingSkill = parser.readSkillFrontmatter('missing-skill', repoRoot);
assert.equal(missingSkill.ok, false);
assert.match(missingSkill.error, /cannot read skill frontmatter/);

const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w8-6-outside-'));
write(path.join(outsideRoot, 'SKILL.md'), `---
current_skill: linked
---
`);
fs.symlinkSync(outsideRoot, path.join(repoRoot, 'skills', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
const linked = parser.readSkillFrontmatter('linked', repoRoot);
assert.equal(linked.ok, false);
assert.match(linked.error, /invalid skill path/);

const linkedRootProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w8-6-linked-root-project-'));
const linkedRootOutside = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w8-6-linked-root-outside-'));
write(path.join(linkedRootOutside, 'external-skill', 'SKILL.md'), `---
current_skill: external-skill
---
`);
fs.mkdirSync(path.join(linkedRootProject, '.opencode'), { recursive: true });
fs.symlinkSync(linkedRootOutside, path.join(linkedRootProject, '.opencode', 'skills'), process.platform === 'win32' ? 'junction' : 'dir');
const linkedRoot = parser.readSkillFrontmatter('external-skill', linkedRootProject);
assert.equal(linkedRoot.ok, false);
assert.match(linkedRoot.error, /invalid skills root/);

const state = {
  current_skill: 'feature-heavy',
  current_step: 8,
  expected_next: 'pipeline-implementer',
};
assert.deepEqual(parser.getCurrentSkill(state), {
  skill: 'feature-heavy',
  step: 8,
  expected_next: 'pipeline-implementer',
});

assert.deepEqual(parser.getVariantSkill({
  pipeline_variant: 'audit-light',
  current_step: 4,
  expected_next: 'pipeline-validator',
}), {
  skill: 'audit-light',
  step: 4,
  expected_next: 'pipeline-validator',
  via_variant: true,
});

assert.equal(parser.getVariantSkill({ pipeline_variant: 'DIRETO', current_step: 1 }), null);
assert.equal(parser.getEnforcementMode(new Date('2026-05-16T00:00:00.000Z')), 'warn');
assert.equal(parser.getEnforcementMode(new Date('2026-05-18T00:00:00.000Z')), 'deny');
process.env.PIPELINE_ENFORCEMENT = 'warn';
assert.equal(parser.getEnforcementMode(new Date('2026-05-18T00:00:00.000Z')), 'deny');
process.env.PIPELINE_ENFORCEMENT_ALLOW_OVERRIDE = '1';
assert.equal(parser.getEnforcementMode(new Date('2026-05-18T00:00:00.000Z')), 'warn');
delete process.env.PIPELINE_ENFORCEMENT;
delete process.env.PIPELINE_ENFORCEMENT_ALLOW_OVERRIDE;

const violation = parser.enforceSkillContract({ current_skill: 'feature-light', current_step: 7 }, repoRoot);
assert.equal(violation.ok, false);
assert.match(violation.violation, /expected_next/);

const enforced = parser.enforceSkillContract({ current_skill: 'feature-light', current_step: 7, expected_next: 'pipeline-implementer' }, repoRoot);
assert.equal(enforced.ok, true);
assert.equal(enforced.enforced, true);

const missingEnforcement = parser.enforceSkillContract({ current_skill: 'missing-skill', current_step: 7 }, repoRoot);
assert.equal(missingEnforcement.ok, false);
assert.match(missingEnforcement.violation, /cannot verify skill frontmatter/);

write(path.join(repoRoot, 'skills', 'audit-light', 'SKILL.md'), `---
sentinel_checkpoints: [4]
---
# Audit Light
`);
const variantViolation = parser.enforceSkillContract({ pipeline_variant: 'audit-light', current_step: 4 }, repoRoot);
assert.equal(variantViolation.ok, false);
assert.match(variantViolation.violation, /expected_next/);

const variantPass = parser.enforceSkillContract({ pipeline_variant: 'audit-light', current_step: 4, expected_next: 'pipeline-validator' }, repoRoot);
assert.equal(variantPass.ok, true);
assert.equal(variantPass.enforced, true);
assert.equal(variantPass.skill, 'audit-light');

const skipped = parser.enforceSkillContract({ current_skill: 'feature-light', current_step: 2 }, repoRoot);
assert.equal(skipped.ok, true);
assert.equal(skipped.enforced, false);

write(path.join(repoRoot, 'skills', 'malformed', 'SKILL.md'), `---
sentinel_checkpoints: not-a-list
---
# Malformed
`);
const malformed = parser.enforceSkillContract({ current_skill: 'malformed', current_step: 7 }, repoRoot);
assert.equal(malformed.ok, false);
assert.match(malformed.violation, /invalid sentinel_checkpoints/);

const logDir = path.join(repoRoot, '.pipeline', 'docs', 'Pre-feature-action', 'run-frontmatter');
fs.mkdirSync(logDir, { recursive: true });
assert.equal(parser.logEnforcementDecision(repoRoot, {
  mode: 'deny',
  hook: 'skill-frontmatter-parser',
  pipeline_doc_path: path.join(os.tmpdir(), 'outside-pipeline-log'),
  detail: 'outside',
}), false);

const linkedLogDir = path.join(repoRoot, '.pipeline', 'docs', 'Pre-feature-action', 'linked-log');
const linkedTargetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w8-6-linked-log-'));
fs.mkdirSync(linkedLogDir, { recursive: true });
fs.writeFileSync(path.join(linkedTargetDir, 'gate-decisions.jsonl'), '');
fs.symlinkSync(path.join(linkedTargetDir, 'gate-decisions.jsonl'), path.join(linkedLogDir, 'gate-decisions.jsonl'), 'file');
assert.equal(parser.logEnforcementDecision(repoRoot, {
  mode: 'deny',
  hook: 'skill-frontmatter-parser',
  pipeline_doc_path: linkedLogDir,
  detail: 'linked log',
}), false);

const linkedPipelineProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w8-6-linked-pipeline-project-'));
const linkedPipelineOutside = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w8-6-linked-pipeline-outside-'));
fs.symlinkSync(linkedPipelineOutside, path.join(linkedPipelineProject, '.pipeline'), process.platform === 'win32' ? 'junction' : 'dir');
const linkedPipelineLogDir = path.join(linkedPipelineProject, '.pipeline', 'docs', 'Pre-feature-action', 'run');
fs.mkdirSync(linkedPipelineLogDir, { recursive: true });
assert.equal(parser.logEnforcementDecision(linkedPipelineProject, {
  mode: 'deny',
  hook: 'skill-frontmatter-parser',
  pipeline_doc_path: linkedPipelineLogDir,
  detail: 'linked pipeline root',
}), false);

assert.equal(parser.logEnforcementDecision(repoRoot, {
  mode: 'deny',
  hook: 'skill-frontmatter-parser',
  pipeline_doc_path: logDir,
  detail: 'missing expected_next\nsecond line',
}), true);
const logged = fs.readFileSync(path.join(logDir, 'gate-decisions.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
assert.equal(logged[0].gate, 'ENFORCEMENT_DENY');
assert.equal(logged[0].decision, 'BLOCKED');
assert.doesNotMatch(logged[0].detail, /\n/);

const skillHookOutput = {};
parser.handleToolExecuteBefore({ cwd: repoRoot, tool: 'skill' }, skillHookOutput, {
  today: new Date('2026-05-18T00:00:00.000Z'),
  pipelineDocPath: logDir,
  findActiveSentinelState: () => ({
    schemaVersion: 'SENTINEL_STATE/v1',
    runId: 'run-frontmatter',
    currentPhase: 'phase_dispatch',
    checkpoints: {},
    blocked: false,
    stopRuleTriggered: false,
    lastValidEventId: null,
    updatedAt: '2026-06-24T04:00:00.000Z',
    pipeline_active: true,
    current_skill: 'feature-light',
    current_step: 7,
  }),
});
assert.equal(skillHookOutput.error.code, 'SKILL_FRONTMATTER_ENFORCEMENT');

const pluginHooks = plugin.createPipelineAdaptationHooks({ directory: repoRoot }, {
  today: new Date('2026-05-18T00:00:00.000Z'),
  pipelineDocPath: logDir,
  findActiveSentinelState: () => ({
    schemaVersion: 'SENTINEL_STATE/v1',
    runId: 'run-frontmatter',
    currentPhase: 'phase_dispatch',
    checkpoints: {},
    blocked: false,
    stopRuleTriggered: false,
    lastValidEventId: null,
    updatedAt: '2026-06-24T04:01:00.000Z',
    pipeline_active: true,
    current_skill: 'feature-light',
    current_step: 7,
  }),
});
const pluginOutput = {};
pluginHooks['tool.execute.before']({ cwd: repoRoot, tool: 'skill' }, pluginOutput);
assert.equal(pluginOutput.error.code, 'SKILL_FRONTMATTER_ENFORCEMENT');

assert.equal(typeof opencodeIndex.parseFrontmatter, 'function');
assert.equal(typeof opencodeIndex.createSkillFrontmatterParserHooks, 'function');

console.log('skill frontmatter parser OK');
