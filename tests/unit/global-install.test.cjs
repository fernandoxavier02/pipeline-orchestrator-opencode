'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  installGlobalArtifacts,
  planGlobalInstall,
  restoreBackup,
  setUserEnvironmentVariable,
  verifyInstalledManifest,
} = require('../../src/install/installer.cjs');

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function makeSourceRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'po-global-source-'));
  write(path.join(root, '.opencode', 'agents', 'pipeline-run-orchestrator.md'), 'agent v1');
  write(path.join(root, '.opencode', 'skills', 'pipeline-orchestrator', 'SKILL.md'), 'skill v1');
  write(path.join(root, '.opencode', 'commands', 'pipeline.md'), 'command v1');
  write(path.join(root, '.opencode', 'plugins', 'pipeline-adaptation-plugin.js'), 'export default async function plugin() { return {}; }\n');
  write(path.join(root, '.opencode', 'plugins', 'pipeline-guard.js'), 'broken project-local import ../../src/opencode/plugin-guard.cjs');
  write(path.join(root, 'src', 'opencode', 'plugin-guard.cjs'), "'use strict';\nmodule.exports = { createPipelineGuardHooks() { return {}; } };\n");
  write(path.join(root, 'src', 'opencode', 'pipeline-adaptation-plugin.cjs'), "'use strict';\nmodule.exports = { createPipelineAdaptationHooks() { return { 'experimental.session.compacting': () => {} }; } };\n");
  write(path.join(root, 'opencode.json'), JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    command: {
      pipeline: {
        description: 'Pipeline command',
        agent: 'pipeline-run-orchestrator',
        template: 'Use the pipeline-orchestrator skill.',
      },
    },
  }, null, 2));
  return root;
}

function runPowerShell(script) {
  const result = spawnSync('powershell', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `PowerShell exited with ${result.status}`);
  }
  return result.stdout;
}

const sourceRoot = makeSourceRoot();
const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'po-global-target-'));
write(path.join(targetRoot, 'opencode.json'), JSON.stringify({
  $schema: 'https://opencode.ai/config.json',
  command: {
    keep: { template: 'keep existing command' },
  },
  provider: {
    qwen: {
      options: { apiKey: 'SECRET_QWEN', baseURL: 'https://example.invalid' },
      models: {},
    },
  },
}, null, 2));
write(path.join(targetRoot, 'commands', 'pipeline.md'), 'old command');

const plan = planGlobalInstall({ sourceRoot, targetRoot });
assert.equal(plan.ok, true);
assert.equal(plan.missingRequired.length, 0);
assert.ok(plan.operations.some((op) => op.relativePath === 'commands/pipeline.md'));
assert.ok(plan.operations.some((op) => op.relativePath === 'plugins/pipeline-guard-runtime.cjs'));
assert.ok(!plan.operations.some((op) => op.relativePath.includes('.opencode/tools')));

const envWrites = [];
const blockedSecretInstall = installGlobalArtifacts({
  sourceRoot,
  targetRoot,
  packageVersion: '0.1.0-test',
  canonicalVersion: '8.0.2-test',
  setUserEnv: (name, value) => envWrites.push([name, value]),
});

assert.equal(blockedSecretInstall.ok, false);
assert.equal(blockedSecretInstall.code, 'GLOBAL_INSTALL_SECRET_MIGRATION_REQUIRES_APPROVAL');
assert.deepEqual(blockedSecretInstall.providers, ['qwen']);
assert.equal(fs.existsSync(path.join(targetRoot, 'agents', 'pipeline-run-orchestrator.md')), false);
assert.equal(fs.existsSync(path.join(targetRoot, 'pipeline-orchestrator-install.manifest.json')), false);
assert.deepEqual(envWrites, []);

const result = installGlobalArtifacts({
  sourceRoot,
  targetRoot,
  packageVersion: '0.1.0-test',
  canonicalVersion: '8.0.2-test',
  setUserEnv: (name, value) => envWrites.push([name, value]),
  migrateProviderSecrets: true,
});

assert.equal(result.ok, true);
assert.ok(fs.existsSync(result.backupPath), 'backup directory created');
assert.equal(
  fs.readFileSync(path.join(result.backupPath, 'commands', 'pipeline.md'), 'utf8'),
  'old command',
);
assert.equal(
  fs.existsSync(path.join(targetRoot, 'agents', 'pipeline-run-orchestrator.md')),
  true,
);
assert.equal(
  fs.readFileSync(path.join(targetRoot, 'commands', 'pipeline.md'), 'utf8'),
  'command v1',
);
assert.equal(
  fs.existsSync(path.join(targetRoot, 'plugins', 'pipeline-guard-runtime.cjs')),
  true,
);
assert.doesNotMatch(
  fs.readFileSync(path.join(targetRoot, 'plugins', 'pipeline-guard.js'), 'utf8'),
  /\.\.\/\.\.\/src/,
);
const installedAdaptationPlugin = fs.readFileSync(path.join(targetRoot, 'plugins', 'pipeline-adaptation-plugin.js'), 'utf8');
assert.doesNotMatch(installedAdaptationPlugin, /return \{\};/);
assert.match(installedAdaptationPlugin, /createPipelineAdaptationHooks/);
assert.equal(
  typeof require(path.join(targetRoot, 'plugins', 'pipeline-adaptation-plugin.js'))({}, {})
    .then,
  'function',
);

const config = JSON.parse(fs.readFileSync(path.join(targetRoot, 'opencode.json'), 'utf8'));
assert.equal(config.command.keep.template, 'keep existing command');
assert.equal(config.command.pipeline.agent, 'pipeline-run-orchestrator');
assert.equal(config.provider.qwen.options.apiKey, '${QWEN_API_KEY}');
assert.deepEqual(envWrites, [['QWEN_API_KEY', 'SECRET_QWEN']]);
assert.ok(config.plugin.includes('./plugins/pipeline-guard.js'));
assert.ok(config.plugin.includes('./plugins/pipeline-adaptation-plugin.js'));
assert.doesNotMatch(
  fs.readFileSync(path.join(result.backupPath, 'opencode.json'), 'utf8'),
  /SECRET_QWEN/,
);

const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
assert.equal(manifest.version, '0.1.0-test');
assert.equal(manifest.canonicalVersion, '8.0.2-test');
assert.ok(manifest.files.length >= 6);
assert.ok(manifest.files.every((entry) => /^[a-f0-9]{64}$/.test(entry.targetSha256)));
assert.doesNotMatch(JSON.stringify(manifest), /SECRET_QWEN/);
assert.equal(verifyInstalledManifest({ targetRoot, manifestPath: result.manifestPath }).ok, true);

const envRefTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'po-global-env-ref-'));
write(path.join(envRefTarget, 'opencode.json'), JSON.stringify({
  provider: { qwen: { options: { apiKey: '${QWEN_API_KEY}' } } },
}, null, 2));
const envRefWrites = [];
const envRefResult = installGlobalArtifacts({
  sourceRoot,
  targetRoot: envRefTarget,
  packageVersion: '0.1.0-test',
  canonicalVersion: '8.0.2-test',
  setUserEnv: (name, value) => envRefWrites.push([name, value]),
});
assert.equal(envRefResult.ok, true);
assert.deepEqual(envRefWrites, []);

write(path.join(targetRoot, 'commands', 'pipeline.md'), 'corrupted command');
const badVerify = verifyInstalledManifest({ targetRoot, manifestPath: result.manifestPath });
assert.equal(badVerify.ok, false);
assert.equal(badVerify.mismatches[0].relativePath, 'commands/pipeline.md');

const restored = restoreBackup({ targetRoot, backupPath: result.backupPath });
assert.equal(restored.ok, true);
assert.equal(
  fs.readFileSync(path.join(targetRoot, 'commands', 'pipeline.md'), 'utf8'),
  'old command',
);

const incompleteSource = fs.mkdtempSync(path.join(os.tmpdir(), 'po-global-incomplete-'));
const incompletePlan = planGlobalInstall({ sourceRoot: incompleteSource, targetRoot });
assert.equal(incompletePlan.ok, false);
assert.ok(incompletePlan.missingRequired.includes('.opencode/agents'));

if (process.platform === 'win32' && process.env.PIPELINE_ORCHESTRATOR_RUN_ENV_TESTS === '1') {
  const envName = `PIPELINE_ORCHESTRATOR_OPENCODE_TEST_${process.pid}_${Date.now()}`;
  const envValue = 'dummy-value';
  try {
    setUserEnvironmentVariable(envName, envValue);
    assert.equal(
      runPowerShell(`[Environment]::GetEnvironmentVariable('${envName}', 'User')`).trim(),
      envValue,
    );
  } finally {
    runPowerShell(`[Environment]::SetEnvironmentVariable('${envName}', $null, 'User')`);
  }
}

console.log('global install OK');
