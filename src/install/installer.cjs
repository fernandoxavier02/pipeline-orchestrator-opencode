'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const GLOBAL_REQUIRED_PATHS = Object.freeze([
  '.opencode/agents',
  '.opencode/skills',
  '.opencode/commands',
  'opencode.json',
  'src/opencode/plugin-guard.cjs',
]);

const GLOBAL_PLUGIN_ENTRIES = Object.freeze([
  './plugins/pipeline-adaptation-plugin.js',
  './plugins/pipeline-guard.js',
]);

const PROVIDER_ENV_NAMES = Object.freeze({
  qwen: 'QWEN_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  zai: 'ZAI_API_KEY',
  'deepseek-api': 'DEEPSEEK_API_KEY',
});

function isInside(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function collectFiles(root, relativeRoot) {
  const absoluteRoot = path.join(root, relativeRoot);
  const files = [];
  if (!fs.existsSync(absoluteRoot)) return files;
  for (const entry of fs.readdirSync(absoluteRoot, { withFileTypes: true })) {
    const childRelative = path.join(relativeRoot, entry.name);
    const childAbsolute = path.join(root, childRelative);
    if (entry.isDirectory()) {
      files.push(...collectFiles(root, childRelative));
    } else if (entry.isFile()) {
      files.push(childAbsolute);
    }
  }
  return files.sort();
}

function makeGlobalPluginArtifacts(sourceRoot) {
  const runtimePath = path.join(sourceRoot, 'src', 'opencode', 'plugin-guard.cjs');
  const adaptationRuntimePath = path.join(sourceRoot, 'src', 'opencode', 'pipeline-adaptation-plugin.cjs');
  return [
    {
      relativePath: 'plugins/pipeline-adaptation-plugin.js',
      content: `'use strict';\n\nconst { createPipelineAdaptationHooks } = require(${JSON.stringify(adaptationRuntimePath)});\n\nmodule.exports = async function pipelineAdaptationPlugin(input = {}, options = {}) {\n  return createPipelineAdaptationHooks(input, options);\n};\n`,
    },
    {
      relativePath: 'plugins/pipeline-guard.js',
      content: "'use strict';\n\nconst { createPipelineGuardHooks } = require('./pipeline-guard-runtime.cjs');\n\nmodule.exports = async function PipelineGuard(_input = {}, options = {}) {\n  return createPipelineGuardHooks({\n    getActiveRun: options.getActiveRun || (() => null),\n    audit: options.audit || (() => {}),\n  });\n};\n",
    },
    {
      relativePath: 'plugins/pipeline-guard-runtime.cjs',
      sourcePath: runtimePath,
    },
  ];
}

function collectGlobalArtifacts(sourceRoot) {
  const directoryArtifacts = ['.opencode/agents', '.opencode/skills', '.opencode/commands']
    .flatMap((relativeRoot) => collectFiles(sourceRoot, relativeRoot))
    .map((sourcePath) => {
      const sourceRelative = toPosix(path.relative(sourceRoot, sourcePath));
      return {
        sourcePath,
        relativePath: sourceRelative.replace(/^\.opencode\//, ''),
      };
    });
  return [...directoryArtifacts, ...makeGlobalPluginArtifacts(sourceRoot)]
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function findMissingRequired(sourceRoot) {
  return GLOBAL_REQUIRED_PATHS.filter((relativePath) => !fs.existsSync(path.join(sourceRoot, relativePath)));
}

function planGlobalInstall({ sourceRoot, targetRoot }) {
  const missingRequired = findMissingRequired(sourceRoot);
  if (missingRequired.length > 0) {
    return { ok: false, code: 'GLOBAL_INSTALL_SOURCE_INCOMPLETE', missingRequired };
  }

  const operations = collectGlobalArtifacts(sourceRoot).map((artifact) => ({
    relativePath: artifact.relativePath,
    action: fs.existsSync(path.join(targetRoot, artifact.relativePath)) ? 'replace' : 'create',
  }));

  return { ok: true, operations, missingRequired: [] };
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function backupFile({ targetRoot, backupPath, relativePath }) {
  const source = path.join(targetRoot, relativePath);
  if (!fs.existsSync(source)) return false;
  const target = path.join(backupPath, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return true;
}

function copyOrWriteArtifact({ artifact, targetRoot }) {
  const target = path.join(targetRoot, artifact.relativePath);
  if (!isInside(target, targetRoot)) {
    return { ok: false, code: 'GLOBAL_INSTALL_TARGET_OUTSIDE_ROOT', attempted: target };
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (artifact.content !== undefined) {
    fs.writeFileSync(target, artifact.content);
  } else {
    const stat = fs.lstatSync(artifact.sourcePath);
    if (stat.isSymbolicLink()) {
      return { ok: false, code: 'GLOBAL_INSTALL_REFUSES_SYMLINK', attempted: artifact.sourcePath };
    }
    fs.copyFileSync(artifact.sourcePath, target);
  }
  return { ok: true, target };
}

function envNameForProvider(providerId) {
  if (PROVIDER_ENV_NAMES[providerId]) return PROVIDER_ENV_NAMES[providerId];
  return `OPENCODE_${providerId.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')}_API_KEY`;
}

function isEnvReference(value) {
  return typeof value === 'string' && /^\$\{[A-Z0-9_]+\}$/.test(value);
}

function findLiteralProviderSecrets(config) {
  const secrets = [];
  if (!config.provider || typeof config.provider !== 'object') return secrets;
  for (const [providerId, provider] of Object.entries(config.provider)) {
    const options = provider && provider.options;
    if (!options || typeof options.apiKey !== 'string' || isEnvReference(options.apiKey)) continue;
    secrets.push({ providerId, envName: envNameForProvider(providerId), secret: options.apiKey });
  }
  return secrets;
}

function redactProviderSecrets(config) {
  const redacted = cloneJson(config);
  for (const secret of findLiteralProviderSecrets(redacted)) {
    redacted.provider[secret.providerId].options.apiKey = '${' + secret.envName + '}';
  }
  return redacted;
}

function migrateProviderSecrets(config, setUserEnv) {
  const migrated = [];
  for (const { providerId, envName, secret } of findLiteralProviderSecrets(config)) {
    if (setUserEnv) setUserEnv(envName, secret);
    config.provider[providerId].options.apiKey = '${' + envName + '}';
    migrated.push({ providerId, envName });
  }
  return migrated;
}

function mergeGlobalConfig({ existingConfig, sourceConfig, setUserEnv }) {
  const merged = {
    ...existingConfig,
    $schema: existingConfig.$schema || sourceConfig.$schema || 'https://opencode.ai/config.json',
    command: {
      ...(existingConfig.command || {}),
      ...(sourceConfig.command || {}),
    },
  };
  const plugin = Array.isArray(existingConfig.plugin) ? [...existingConfig.plugin] : [];
  for (const entry of GLOBAL_PLUGIN_ENTRIES) {
    if (!plugin.includes(entry)) plugin.push(entry);
  }
  merged.plugin = plugin;
  const migratedSecrets = migrateProviderSecrets(merged, setUserEnv);
  return { merged, migratedSecrets };
}

function setUserEnvironmentVariable(name, value) {
  if (process.platform !== 'win32') {
    throw new Error(`user environment persistence is not implemented for ${process.platform}`);
  }
  const script = "[Environment]::SetEnvironmentVariable($env:OPENCODE_ENV_NAME, $env:OPENCODE_ENV_VALUE, 'User')";
  const result = spawnSync('powershell', [
    '-NoProfile',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ], {
    encoding: 'utf8',
    stdio: 'pipe',
    env: {
      ...process.env,
      OPENCODE_ENV_NAME: name,
      OPENCODE_ENV_VALUE: value,
    },
  });
  if (result.status !== 0) {
    throw new Error(`failed to persist environment variable ${name}`);
  }
}

function installGlobalArtifacts({
  sourceRoot,
  targetRoot,
  packageVersion,
  canonicalVersion,
  setUserEnv = setUserEnvironmentVariable,
  migrateProviderSecrets: allowSecretMigration = false,
}) {
  const plan = planGlobalInstall({ sourceRoot, targetRoot });
  if (!plan.ok) return plan;

  const existingConfigPath = path.join(targetRoot, 'opencode.json');
  const sourceConfigPath = path.join(sourceRoot, 'opencode.json');
  const existingConfig = readJsonIfExists(existingConfigPath);
  const literalSecrets = findLiteralProviderSecrets(existingConfig);
  if (literalSecrets.length > 0 && !allowSecretMigration) {
    return {
      ok: false,
      code: 'GLOBAL_INSTALL_SECRET_MIGRATION_REQUIRES_APPROVAL',
      providers: literalSecrets.map((secret) => secret.providerId),
    };
  }

  const { merged, migratedSecrets } = mergeGlobalConfig({
    existingConfig,
    sourceConfig: readJsonIfExists(sourceConfigPath),
    setUserEnv,
  });

  const backupPath = path.join(targetRoot, 'backups', `pipeline-orchestrator-opencode-${timestamp()}`);
  fs.mkdirSync(backupPath, { recursive: true });

  const artifacts = collectGlobalArtifacts(sourceRoot);
  const backedUp = [];
  for (const artifact of artifacts) {
    if (backupFile({ targetRoot, backupPath, relativePath: artifact.relativePath })) {
      backedUp.push(artifact.relativePath);
    }
  }
  if (fs.existsSync(existingConfigPath)) {
    writeJson(path.join(backupPath, 'opencode.json'), redactProviderSecrets(existingConfig));
    backedUp.push('opencode.json');
  }
  for (const relativePath of ['pipeline-orchestrator-install.manifest.json']) {
    if (backupFile({ targetRoot, backupPath, relativePath })) backedUp.push(relativePath);
  }

  const installedFiles = [];
  for (const artifact of artifacts) {
    const copied = copyOrWriteArtifact({ artifact, targetRoot });
    if (!copied.ok) return copied;
    installedFiles.push({
      relativePath: artifact.relativePath,
      owner: 'pipeline-orchestrator-opencode-adaptation',
      uninstall: 'delete',
      targetSha256: sha256File(copied.target),
    });
  }

  writeJson(existingConfigPath, merged);
  installedFiles.push({
    relativePath: 'opencode.json',
    owner: 'pipeline-orchestrator-opencode-adaptation',
    uninstall: 'manual-merge',
    targetSha256: sha256File(existingConfigPath),
  });

  const manifestPath = path.join(targetRoot, 'pipeline-orchestrator-install.manifest.json');
  writeJson(manifestPath, {
    name: 'pipeline-orchestrator-opencode-install',
    schemaVersion: 1,
    version: packageVersion,
    canonicalVersion,
    installedAt: new Date().toISOString(),
    scope: 'global',
    source: 'pipeline-orchestrator-opencode-adaptation',
    backupRelativePath: toPosix(path.relative(targetRoot, backupPath)),
    backedUp,
    migratedSecrets,
    files: installedFiles,
  });

  const verified = verifyInstalledManifest({ targetRoot, manifestPath });
  if (!verified.ok) return { ok: false, code: 'GLOBAL_INSTALL_VERIFY_FAILED', ...verified };
  return { ok: true, backupPath, manifestPath, files: installedFiles, migratedSecrets };
}

function verifyInstalledManifest({ targetRoot, manifestPath }) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const mismatches = [];
  for (const entry of files) {
    const target = path.join(targetRoot, entry.relativePath);
    if (!fs.existsSync(target)) {
      mismatches.push({ relativePath: entry.relativePath, reason: 'missing' });
      continue;
    }
    const actual = sha256File(target);
    if (actual !== entry.targetSha256) {
      mismatches.push({ relativePath: entry.relativePath, reason: 'hash', expected: entry.targetSha256, actual });
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

function restoreBackup({ targetRoot, backupPath }) {
  if (!fs.existsSync(backupPath)) return { ok: false, code: 'BACKUP_NOT_FOUND' };
  const restored = [];
  for (const filePath of collectFiles(backupPath, '')) {
    const relativePath = toPosix(path.relative(backupPath, filePath));
    const target = path.join(targetRoot, relativePath);
    if (!isInside(target, targetRoot)) {
      return { ok: false, code: 'RESTORE_TARGET_OUTSIDE_ROOT', attempted: target };
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(filePath, target);
    restored.push(relativePath);
  }
  return { ok: true, restored };
}

function installArtifacts({ sourceRoot, targetRoot, adaptationRoot, artifacts, protectedRoots }) {
  if (protectedRoots.some((root) => isInside(targetRoot, root) || isInside(adaptationRoot, root))) {
    return { ok: false, code: 'INSTALL_TARGET_PROTECTED' };
  }

  const manifestPath = path.join(targetRoot, 'install-manifest.json');
  if (!isInside(manifestPath, adaptationRoot)) {
    return { ok: false, code: 'MANIFEST_OUTSIDE_ADAPTATION' };
  }

  const installed = [];
  for (const artifact of artifacts) {
    const source = path.join(sourceRoot, artifact.relativePath);
    const target = path.join(targetRoot, artifact.relativePath);
    if (!isInside(target, adaptationRoot)) {
      return { ok: false, code: 'INSTALL_TARGET_OUTSIDE_ADAPTATION', attempted: target };
    }
    if (protectedRoots.some((root) => isInside(target, root))) {
      return { ok: false, code: 'INSTALL_TARGET_PROTECTED', attempted: target };
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    installed.push({
      relativePath: artifact.relativePath,
      owner: 'opencode-adaptation',
      target,
    });
  }

  fs.writeFileSync(manifestPath, JSON.stringify({
    schemaVersion: 1,
    artifacts: installed,
  }, null, 2) + '\n');

  return { ok: true, manifestPath, artifacts: installed };
}

module.exports = {
  installArtifacts,
  installGlobalArtifacts,
  findLiteralProviderSecrets,
  isInside,
  planGlobalInstall,
  restoreBackup,
  setUserEnvironmentVariable,
  verifyInstalledManifest,
};
