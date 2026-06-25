'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const configPath = path.join(root, 'opencode.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  assert.equal(Array.isArray(config.plugin), true);
  assert.deepEqual(config.plugin, [
    './.opencode/plugins/pipeline-adaptation-plugin.js',
    './.opencode/plugins/pipeline-guard.js',
  ]);

  for (const pluginPath of config.plugin) {
    const absPath = path.resolve(root, pluginPath);
    assert.equal(fs.existsSync(absPath), true, `${pluginPath} must exist`);
    const pluginModule = await import(pathToFileURL(absPath).href);
    assert.equal(typeof pluginModule.default, 'function', `${pluginPath} must export default plugin`);
  }

  const adaptationModule = await import(pathToFileURL(path.resolve(root, config.plugin[0])).href);
  const adaptationHooks = await adaptationModule.default({ directory: root }, { projectDir: root });
  assert.equal(typeof adaptationHooks['tool.execute.before'], 'function');
  assert.equal(typeof adaptationHooks['tool.execute.after'], 'function');
  assert.equal(typeof adaptationHooks.event, 'function');
  assert.equal(typeof adaptationHooks['session.idle'], 'function');
  assert.equal(typeof adaptationHooks['permission.replied'], 'function');
  assert.equal(typeof adaptationHooks['question.replied'], 'function');
  assert.equal(typeof adaptationHooks['experimental.session.compacting'], 'function');

  const guardModule = await import(pathToFileURL(path.resolve(root, config.plugin[1])).href);
  assert.equal(guardModule.default, guardModule.PipelineGuard);
  const guardHooks = await guardModule.default({}, { getActiveRun: () => null, audit: () => {} });
  assert.equal(typeof guardHooks['tool.execute.before'], 'function');
  assert.equal(typeof guardHooks['tool.execute.after'], 'function');

  console.log('w10.6 plugin manifest OK');
})();
