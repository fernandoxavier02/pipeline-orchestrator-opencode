'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const force = require('../../src/opencode/force-pipeline-agents.cjs');
const plugin = require('../../src/opencode/pipeline-adaptation-plugin.cjs');
const opencodeIndex = require('../../src/opencode/index.cjs');
const { markerPath } = require('../../src/lib/pipeline-arm.cjs');

function messageOf(output) {
  return output.systemMessage || output.system_message || output.message || '';
}

function promptInput(text, cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w8-3-force-'))) {
  return { cwd, text };
}

assert.equal(force.isTrivialChat('oi'), true);
assert.equal(force.isPipelineWorthy('corrigir bug no login'), true);
assert.equal(force.isPipelineCommand('/pipeline feature criar tela'), true);

let output = {};
force.handlePromptAppend(promptInput('oi'), output);
assert.equal(messageOf(output), '');

output = {};
force.handlePromptAppend(promptInput('/pipeline feature criar tela'), output);
assert.match(messageOf(output), /FASES OBRIGATORIAS/);
assert.match(messageOf(output), /LOCAL OPENCODE/);

output = {};
force.handlePromptAppend(promptInput('corrigir bug no login e adicionar teste'), output);
assert.match(messageOf(output), /PIPELINE DE AGENTES/);
assert.match(messageOf(output), /pipeline-run-orchestrator/);
assert.match(messageOf(output), /nao implemente inline/i);

output = {};
force.handlePromptAppend(promptInput('explique o que esse modulo faz'), output);
assert.match(messageOf(output), /Considere usar o Pipeline Orchestrator/);

output = {};
force.handleEvent({ cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'po-w8-3-event-')), event: { type: 'tui.prompt.append', properties: { text: 'adicionar botao novo' } } }, output);
assert.match(messageOf(output), /PIPELINE DE AGENTES/);

const hooks = force.createForcePipelineAgentsHooks();
output = {};
hooks['tui.prompt.append'](promptInput('implementar tela nova'), output);
assert.match(messageOf(output), /PIPELINE DE AGENTES/);

const pluginProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w8-3-plugin-'));
const pluginHooks = plugin.createPipelineAdaptationHooks({ directory: pluginProject });
output = { systemMessage: 'existing system message' };
pluginHooks['tui.prompt.append']({ text: 'implementar tela nova' }, output);
assert.match(messageOf(output), /existing system message/);
assert.match(messageOf(output), /PIPELINE DE AGENTES/);

const armProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w8-3-arm-'));
const armHooks = plugin.createPipelineAdaptationHooks({ directory: armProject }, { nowIso: '2026-06-24T02:00:00.000Z' });
output = {};
armHooks['tui.prompt.append']({ text: '/feature-light criar painel' }, output);
assert.equal(fs.existsSync(markerPath(armProject)), true);
assert.match(messageOf(output), /FASES OBRIGATORIAS/);

assert.equal(typeof opencodeIndex.createForcePipelineAgentsHooks, 'function');

console.log('force pipeline agents OK');
