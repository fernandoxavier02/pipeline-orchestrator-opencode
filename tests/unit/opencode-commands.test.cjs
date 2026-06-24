'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { validateCommandConfig } = require('../../src/opencode/command-validator.cjs');

const root = path.resolve(__dirname, '..', '..');
const result = validateCommandConfig({
  root,
  commandNames: [
    'pipeline',
    'bugfix',
    'bugfix-light',
    'bugfix-heavy',
    'feature-light',
    'feature-heavy',
    'verify-completion',
  ],
});

assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
assert.equal(result.commands.length, 7);
assert.equal(result.configCommands.length, 7);
assert.equal(result.configPath, path.join(root, 'opencode.json'));

for (const command of result.commands) {
  assert.equal(typeof command.description, 'string');
  assert.equal(command.description.length > 0, true);
  assert.equal(typeof command.template, 'string');
  assert.match(command.template, /Use the pipeline-orchestrator skill|Use the pipeline-|Use the verify-completion skill/);
  assert.match(command.template, /structured gates/i);
  assert.match(command.template, /RED/i);
  assert.match(command.template, /GREEN/i);
  assert.match(command.template, /adversarial review|review result/i);
  assert.equal(command.agent, 'pipeline-run-orchestrator');
}

const verifyCompletion = result.commands.find((command) => command.name === 'verify-completion');
assert.ok(verifyCompletion);
assert.match(verifyCompletion.template, /verify-completion skill/);
assert.match(verifyCompletion.template, /final verdict/i);

for (const command of result.configCommands) {
  const fileCommand = result.commands.find((candidate) => candidate.name === command.name);
  assert.equal(typeof command.description, 'string');
  assert.equal(typeof command.template, 'string');
  assert.equal(command.agent, 'pipeline-run-orchestrator');
  assert.equal(command.description, fileCommand.description);
  assert.equal(command.agent, fileCommand.agent);
  assert.equal(command.template, fileCommand.template);
}

console.log('opencode commands OK');
