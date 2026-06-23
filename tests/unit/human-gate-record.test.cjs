'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const recorder = require('../../src/opencode/human-gate-record.cjs');
const plugin = require('../../src/opencode/pipeline-adaptation-plugin.cjs');
const opencodeIndex = require('../../src/opencode/index.cjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function sentinel(overrides = {}) {
  return {
    schemaVersion: 'SENTINEL_STATE/v1',
    runId: 'run-human-gate',
    currentPhase: 'phase_0_to_1',
    checkpoints: {},
    blocked: false,
    stopRuleTriggered: false,
    lastValidEventId: null,
    updatedAt: new Date().toISOString(),
    pipeline_active: true,
    workflow_key: 'FULL',
    task_type: 'feature',
    complexity: 'light',
    ...overrides,
  };
}

function projectWithState(state) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w6-1-human-gate-'));
  const runDir = path.join(project, '.pipeline', 'docs', 'Pre-feature-action', state.runId || 'run-human-gate');
  writeJson(path.join(runDir, 'sentinel-state.json'), state);
  writeJson(path.join(project, '.pipeline', 'active-run.json'), { pipeline_doc_path: runDir });
  return { project, runDir };
}

function permissionReply(project, response = ['Aprovar W6.1']) {
  return {
    cwd: project,
    event: 'permission.replied',
    tool: 'question',
    toolName: 'question',
    tool_name: 'question',
    tool_use_id: 'question-1',
    args: { question: 'Pode seguir?', header: 'Gate' },
    tool_response: response,
  };
}

function questionReply(project, answers = ['Aprovar via question.replied']) {
  return {
    cwd: project,
    event: 'question.replied',
    tool_use_id: 'question-event-1',
    answers,
  };
}

function questionEvent(answers = ['Aprovar via event hook']) {
  return {
    event: {
      id: 'event-question-1',
      type: 'question.replied',
      properties: { answers },
    },
  };
}

function permissionEvent(reply = 'once') {
  return {
    event: {
      id: 'event-permission-1',
      type: 'permission.replied',
      properties: { requestID: 'permission-request-1', reply },
    },
  };
}

function secretQuestionEvent() {
  const fakeKey = 'sk-' + 'abcdefghij';
  return {
    event: {
      id: `${fakeKey} path=C:\\Users\\win\\secret`,
      type: 'question.replied',
      properties: { answers: ['id should be redacted'] },
    },
  };
}

let output = {};
recorder.handlePermissionReplied({ cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'po-w6-1-no-state-')), tool: 'question', tool_response: 'ok' }, output);
assert.equal(output.error, undefined);
assert.equal(output.warning, undefined);

const governed = projectWithState(sentinel());
output = {};
recorder.handlePermissionReplied(permissionReply(governed.project), output, { nowIso: '2026-06-23T12:00:00.000Z' });
assert.equal(output.error, undefined);
assert.equal(output.warning, undefined);

let rows = readJsonl(path.join(governed.runDir, 'gate-decisions.jsonl'));
assert.equal(rows.length, 1);
assert.equal(rows[0].gate, 'HUMAN_GATE');
assert.equal(rows[0].hardness, 'AUDIT');
assert.equal(rows[0].phase, 'phase_0_to_1');
assert.equal(rows[0].decision, 'CONFIRMED');
assert.equal(rows[0].decided_by, 'user');
assert.equal(rows[0].confidence_impact, 0);
assert.equal(rows[0].run_id, 'run-human-gate');
assert.match(rows[0].detail, /tool_use_id=question-1/);
assert.match(rows[0].detail, /Aprovar W6\.1/);

recorder.handlePermissionReplied(questionReply(governed.project, ['Evento realista']), {}, { nowIso: '2026-06-23T12:00:30.000Z' });
rows = readJsonl(path.join(governed.runDir, 'gate-decisions.jsonl'));
assert.equal(rows.length, 2);
assert.match(rows[1].detail, /tool_use_id=question-event-1/);
assert.match(rows[1].detail, /Evento realista/);

// Acceptance: the observer records the real answer shape but never treats CONFIRMED as approval.
const rejected = projectWithState(sentinel({ runId: 'run-human-reject' }));
recorder.handlePermissionReplied(permissionReply(rejected.project, ['Rejeitar']), {}, { nowIso: '2026-06-23T12:01:00.000Z' });
rows = readJsonl(path.join(rejected.runDir, 'gate-decisions.jsonl'));
assert.equal(rows[0].decision, 'CONFIRMED');
assert.match(rows[0].detail, /Rejeitar/);

// Acceptance: unrelated events are ignored.
const ignored = projectWithState(sentinel({ runId: 'run-human-ignore' }));
recorder.handlePermissionReplied({ cwd: ignored.project, event: 'session.updated', response: 'ok' }, {});
assert.equal(fs.existsSync(path.join(ignored.runDir, 'gate-decisions.jsonl')), false);

const noAnswer = projectWithState(sentinel({ runId: 'run-human-no-answer' }));
recorder.handlePermissionReplied({ cwd: noAnswer.project, event: 'question.replied', tool: 'question' }, {});
assert.equal(fs.existsSync(path.join(noAnswer.runDir, 'gate-decisions.jsonl')), false);
recorder.handlePermissionReplied(questionReply(noAnswer.project, []), {});
assert.equal(fs.existsSync(path.join(noAnswer.runDir, 'gate-decisions.jsonl')), false);
recorder.handlePermissionReplied(questionReply(noAnswer.project, ['   ']), {});
assert.equal(fs.existsSync(path.join(noAnswer.runDir, 'gate-decisions.jsonl')), false);
recorder.handlePermissionReplied({ cwd: noAnswer.project, event: 'question.replied', answer: null }, {});
assert.equal(fs.existsSync(path.join(noAnswer.runDir, 'gate-decisions.jsonl')), false);

// Acceptance: inactive and corrupt states are fail-silent observer no-ops.
const inactive = projectWithState(sentinel({ runId: 'run-human-inactive', pipeline_active: false }));
recorder.handlePermissionReplied(permissionReply(inactive.project), {});
assert.equal(fs.existsSync(path.join(inactive.runDir, 'gate-decisions.jsonl')), false);

const corruptProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w6-1-human-corrupt-'));
const corruptRunDir = path.join(corruptProject, '.pipeline', 'docs', 'Pre-feature-action', 'run-corrupt');
fs.mkdirSync(corruptRunDir, { recursive: true });
fs.writeFileSync(path.join(corruptRunDir, 'sentinel-state.json'), '{bad json');
writeJson(path.join(corruptProject, '.pipeline', 'active-run.json'), { pipeline_doc_path: corruptRunDir });
recorder.handlePermissionReplied(permissionReply(corruptProject), {});
assert.equal(fs.existsSync(path.join(corruptRunDir, 'gate-decisions.jsonl')), false);

// Acceptance: answer summaries are bounded and newline-safe.
const summarized = recorder.summarizeAnswer({ label: 'Sim\ncom quebra', nested: { ok: true } });
assert.equal(summarized.includes('\n'), false);
assert.equal(summarized.length <= 200, true);
assert.match(recorder.summarizeAnswer('password=abc123 token=xyz'), /password=\[REDACTED_SECRET\]/);
assert.match(recorder.summarizeAnswer('password=abc123 token=xyz'), /token=\[REDACTED_SECRET\]/);
assert.match(recorder.summarizeAnswer('Authorization: Bearer abcdefghijklmnopqrstuvwxyz'), /Bearer \[REDACTED_SECRET\]/);
const fakeOpenAiKey = 'sk-' + 'abcdefghij';
const fakeSlackToken = 'xoxb-' + '1234567890-token';
assert.equal(recorder.summarizeAnswer(`OPENAI_API_KEY ${fakeOpenAiKey}`), 'OPENAI_API_KEY [REDACTED_SECRET]');
assert.equal(recorder.summarizeAnswer(`OPENAI_API_KEY=${fakeOpenAiKey}`), 'OPENAI_API_KEY=[REDACTED_SECRET]');
assert.equal(recorder.summarizeAnswer(fakeSlackToken), '[REDACTED_SECRET]');
assert.equal(recorder.summarizeAnswer('glpat-abcdefghijklmnop'), '[REDACTED_SECRET]');
assert.equal(recorder.summarizeAnswer({ password: 'abc123', nested: { OPENAI_API_KEY: fakeOpenAiKey } }), '{"password":"[REDACTED_SECRET]","nested":{"OPENAI_API_KEY":"[REDACTED_SECRET]"}}');
assert.equal(recorder.sanitizeIdentifier(`${fakeOpenAiKey} path=C:\\Users\\win\\secret`), '[REDACTED_SECRET]_path_[REDACTED_PATH]');
assert.equal(recorder.humanGateCanSatisfyRequiredGates(), false);

// Acceptance: explicit external runDir options and gate-log symlinks do not write outside the active run.
const external = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w6-1-human-external-'));
recorder.handlePermissionReplied(permissionReply(governed.project, ['External attempt']), {}, { runDir: external });
assert.equal(fs.existsSync(path.join(external, 'gate-decisions.jsonl')), false);
rows = readJsonl(path.join(governed.runDir, 'gate-decisions.jsonl'));
assert.equal(rows.length, 3);

const siblingRunDir = path.join(governed.project, '.pipeline', 'docs', 'Pre-feature-action', 'sibling-run');
fs.mkdirSync(siblingRunDir, { recursive: true });
recorder.handlePermissionReplied(permissionReply(governed.project, ['Sibling attempt']), {}, { runDir: siblingRunDir });
assert.equal(fs.existsSync(path.join(siblingRunDir, 'gate-decisions.jsonl')), false);
rows = readJsonl(path.join(governed.runDir, 'gate-decisions.jsonl'));
assert.equal(rows.length, 4);

const linked = projectWithState(sentinel({ runId: 'run-human-linked' }));
const outsideGateFile = path.join(external, 'linked-gate-decisions.jsonl');
const localGateFile = path.join(linked.runDir, 'gate-decisions.jsonl');
let symlinkCreated = false;
try {
  fs.symlinkSync(outsideGateFile, localGateFile);
  symlinkCreated = true;
} catch (_) {
  // Windows may require elevated privileges for file symlinks.
}
if (symlinkCreated) {
  recorder.handlePermissionReplied(permissionReply(linked.project, ['Symlink attempt']), {});
  assert.equal(fs.existsSync(outsideGateFile), false);
}

const hardLinked = projectWithState(sentinel({ runId: 'run-human-hardlink' }));
const outsideHardlinkFile = path.join(external, 'hardlink-gate-decisions.jsonl');
const localHardlinkFile = path.join(hardLinked.runDir, 'gate-decisions.jsonl');
let hardlinkCreated = false;
try {
  fs.writeFileSync(outsideHardlinkFile, 'outside\n');
  fs.linkSync(outsideHardlinkFile, localHardlinkFile);
  hardlinkCreated = true;
} catch (_) {
  // Some filesystems or policies may block hardlink creation.
}
if (hardlinkCreated) {
  recorder.handlePermissionReplied(permissionReply(hardLinked.project, ['Hardlink attempt']), {});
  assert.equal(fs.readFileSync(outsideHardlinkFile, 'utf8'), 'outside\n');
}

// Acceptance: hook factory, plugin composition, and index expose W6.1.
const hooks = recorder.createHumanGateRecordHooks({ projectDir: () => governed.project, nowIso: '2026-06-23T12:02:00.000Z' });
hooks['permission.replied'](permissionReply(governed.project, ['Segunda resposta']), {});
rows = readJsonl(path.join(governed.runDir, 'gate-decisions.jsonl'));
assert.equal(rows.length, 5);

hooks['question.replied'](questionReply(governed.project, ['Hook question reply']), {});
rows = readJsonl(path.join(governed.runDir, 'gate-decisions.jsonl'));
assert.equal(rows.length, 6);

hooks.event(questionEvent(['Hook generic event']), {});
rows = readJsonl(path.join(governed.runDir, 'gate-decisions.jsonl'));
assert.equal(rows.length, 7);
assert.match(rows.at(-1).detail, /tool_use_id=event-question-1/);

hooks.event(permissionEvent('reject'), {});
rows = readJsonl(path.join(governed.runDir, 'gate-decisions.jsonl'));
assert.equal(rows.length, 8);
assert.match(rows.at(-1).detail, /tool_use_id=permission-request-1/);
assert.match(rows.at(-1).detail, /reject/);

hooks.event(secretQuestionEvent(), {});
rows = readJsonl(path.join(governed.runDir, 'gate-decisions.jsonl'));
assert.equal(rows.length, 9);
assert.match(rows.at(-1).detail, /tool_use_id=\[REDACTED_SECRET\]_path_\[REDACTED_PATH\]/);

let auditPayload = null;
recorder.handlePermissionReplied(questionReply(governed.project, ['Audit callback']), {}, { projectDir: governed.project, audit: (payload) => { auditPayload = payload; } });
assert.equal(auditPayload.recorded, true);
assert.equal(Object.prototype.hasOwnProperty.call(auditPayload, 'runDir'), false);
assert.equal(Object.prototype.hasOwnProperty.call(auditPayload, 'record'), false);
rows = readJsonl(path.join(governed.runDir, 'gate-decisions.jsonl'));
assert.equal(rows.length, 10);

auditPayload = null;
recorder.handlePermissionReplied(questionReply(governed.project, ['Audit write fail']), {}, {
  projectDir: governed.project,
  appendGateDecision: () => false,
  audit: (payload) => { auditPayload = payload; },
});
assert.equal(auditPayload.recorded, false);

const pluginHooks = plugin.createPipelineAdaptationHooks({ directory: governed.project }, { nowIso: '2026-06-23T12:03:00.000Z' });
pluginHooks['permission.replied'](permissionReply(governed.project, ['Via plugin']), {});
rows = readJsonl(path.join(governed.runDir, 'gate-decisions.jsonl'));
assert.equal(rows.length, 11);

pluginHooks['question.replied'](questionReply(governed.project, ['Via plugin question']), {});
rows = readJsonl(path.join(governed.runDir, 'gate-decisions.jsonl'));
assert.equal(rows.length, 12);

pluginHooks.event(questionEvent(['Via plugin event']), {});
rows = readJsonl(path.join(governed.runDir, 'gate-decisions.jsonl'));
assert.equal(rows.length, 13);

assert.equal(typeof opencodeIndex.createHumanGateRecordHooks, 'function');

async function assertOpenCodePluginFileRegistersHumanGate() {
  const pluginFile = path.join(__dirname, '..', '..', '.opencode', 'plugins', 'pipeline-adaptation-plugin.js');
  const pluginModule = await import(pathToFileURL(pluginFile).href);
  const hooksFromFile = await pluginModule.default({ directory: governed.project }, { nowIso: '2026-06-23T12:04:00.000Z' });
  hooksFromFile.event(questionEvent(['Via plugin file']), {});
  rows = readJsonl(path.join(governed.runDir, 'gate-decisions.jsonl'));
  assert.equal(rows.length, 14);
}

assertOpenCodePluginFileRegistersHumanGate()
  .then(() => console.log('human gate record OK'))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
