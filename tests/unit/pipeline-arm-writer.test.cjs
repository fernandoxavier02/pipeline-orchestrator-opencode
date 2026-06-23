'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { markerPath } = require('../../src/lib/pipeline-arm.cjs');
const writer = require('../../src/opencode/pipeline-arm-writer.cjs');
const plugin = require('../../src/opencode/pipeline-adaptation-plugin.cjs');
const opencodeIndex = require('../../src/opencode/index.cjs');

function readMarker(project) {
  return JSON.parse(fs.readFileSync(markerPath(project), 'utf8'));
}

const project = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w1-3-arm-writer-'));
const prompt = '/pipeline-orchestrator:bugfix --light corrigir falha no login';

// Acceptance: prompt append side-effect writes the W1.1 arm-pending marker.
let output = {};
writer.handlePromptAppend({ cwd: project, prompt }, output, { nowIso: '2026-06-22T13:00:00.000Z' });
assert.equal(output.error, undefined);
let marker = readMarker(project);
assert.equal(marker.requested_at, '2026-06-22T13:00:00.000Z');
assert.equal(marker.workflow, 'FULL/Bug Fix');
assert.equal(marker.type, 'Bug Fix');
assert.equal(marker.variant, 'light');

// Acceptance: normal prompts do not create a marker.
const normalProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w1-3-arm-writer-normal-'));
writer.handlePromptAppend({ cwd: normalProject, prompt: 'explique o projeto' }, {}, { nowIso: '2026-06-22T13:00:00.000Z' });
assert.equal(fs.existsSync(markerPath(normalProject)), false);

// Acceptance: local OpenCode entry-point commands also arm the pipeline.
const localCommandProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w1-3-arm-writer-local-'));
writer.handlePromptAppend({ cwd: localCommandProject, prompt: '/bugfix-light corrigir login' }, {}, { nowIso: '2026-06-22T13:00:30.000Z' });
marker = readMarker(localCommandProject);
assert.equal(marker.workflow, 'FULL/Bug Fix');
assert.equal(marker.variant, 'light');

// Acceptance: hook factory exposes tui.prompt.append and uses configured project dir.
const hookProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w1-3-arm-writer-hook-'));
const hooks = writer.createPipelineArmWriterHooks({ projectDir: () => hookProject, nowIso: '2026-06-22T13:01:00.000Z' });
assert.equal(typeof hooks['tui.prompt.append'], 'function');
hooks['tui.prompt.append']({ text: '/pipeline audit --heavy revisar seguranca' }, {});
marker = readMarker(hookProject);
assert.equal(marker.workflow, 'FULL/Audit');
assert.equal(marker.variant, 'heavy');

// Acceptance: event fallback handles the documented OpenCode event bus without blocking.
const eventProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w1-3-arm-writer-event-'));
const eventHooks = writer.createPipelineArmWriterHooks({ nowIso: '2026-06-22T13:02:00.000Z' });
assert.equal(typeof eventHooks.event, 'function');
eventHooks.event({ cwd: eventProject, event: { type: 'tui.prompt.append', properties: { text: '/pipeline feature criar tela' } } }, {});
marker = readMarker(eventProject);
assert.equal(marker.workflow, 'FULL/Feature');

// Acceptance: missing project directory does not fall back to process.cwd().
const missingDirEvents = [];
writer.handlePromptAppend({ prompt }, {}, { audit: (event) => missingDirEvents.push(event) });
assert.equal(missingDirEvents.some((event) => event.reason === 'missing_project_dir'), true);

// Acceptance: writer is fail-open; write errors are audited but never block prompt submission.
const events = [];
assert.doesNotThrow(() => writer.handlePromptAppend(
  { cwd: project, prompt },
  {},
  {
    audit: (event) => events.push(event),
    writeArmPending: () => { throw new Error('disk denied'); },
  },
));
assert.equal(events.some((event) => event.type === 'pipeline-arm.writer.error'), true);
assert.equal(events.some((event) => Object.prototype.hasOwnProperty.call(event, 'message')), false);

// Acceptance: the OpenCode plugin factory registers the writer path, not only the index export.
const pluginProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w1-3-arm-writer-plugin-'));
const pluginHooks = plugin.createPipelineAdaptationHooks({ directory: pluginProject }, { nowIso: '2026-06-22T13:03:00.000Z' });
pluginHooks['tui.prompt.append']({ text: '/audit-heavy revisar autorizacao' }, {});
marker = readMarker(pluginProject);
assert.equal(marker.workflow, 'FULL/Audit');
assert.equal(marker.variant, 'heavy');

// Acceptance: module is exported through the OpenCode index.
assert.equal(typeof opencodeIndex.createPipelineArmWriterHooks, 'function');
assert.equal(typeof opencodeIndex.createPipelineAdaptationHooks, 'function');

async function assertOpenCodePluginFileRegistersWriter() {
  const pluginFile = path.join(__dirname, '..', '..', '.opencode', 'plugins', 'pipeline-adaptation-plugin.js');
  const pluginModule = await import(pathToFileURL(pluginFile).href);
  const actualPluginProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w1-3-arm-writer-plugin-file-'));
  const hooksFromFile = await pluginModule.default({ directory: actualPluginProject }, { nowIso: '2026-06-22T13:04:00.000Z' });
  assert.equal(typeof hooksFromFile['tui.prompt.append'], 'function');
  hooksFromFile['tui.prompt.append']({ text: '/feature-light criar painel' }, {});
  const pluginFileMarker = readMarker(actualPluginProject);
  assert.equal(pluginFileMarker.workflow, 'FULL/Feature');
  assert.equal(pluginFileMarker.variant, 'light');
}

assertOpenCodePluginFileRegistersWriter()
  .then(() => console.log('pipeline arm writer OK'))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
