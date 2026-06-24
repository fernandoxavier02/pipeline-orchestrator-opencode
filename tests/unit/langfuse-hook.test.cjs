'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const langfuse = require('../../src/opencode/langfuse-hook.cjs');
const plugin = require('../../src/opencode/pipeline-adaptation-plugin.cjs');
const opencodeIndex = require('../../src/opencode/index.cjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function sentinel(overrides = {}) {
  return {
    schemaVersion: 'SENTINEL_STATE/v1',
    runId: 'run-langfuse',
    currentPhase: 'phase_5_to_6',
    checkpoints: {},
    blocked: false,
    stopRuleTriggered: false,
    lastValidEventId: null,
    updatedAt: new Date().toISOString(),
    pipeline_active: true,
    workflow_key: 'FULL',
    task_type: 'feature',
    complexity: 'medium',
    ...overrides,
  };
}

function projectWithState(state) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w6-2-langfuse-'));
  const runDir = path.join(project, '.pipeline', 'docs', 'Pre-feature-action', state.runId || 'run-langfuse');
  writeJson(path.join(runDir, 'sentinel-state.json'), state);
  writeJson(path.join(project, '.pipeline', 'active-run.json'), { pipeline_doc_path: runDir });
  return { project, runDir };
}

function agentInput(project, overrides = {}) {
  return {
    cwd: project,
    tool: 'task',
    tool_use_id: 'dispatch-1',
    args: {
      agentName: 'pipeline-implementer',
      prompt: 'implement safely password=abc123',
      description: 'Implementation agent',
    },
    ...overrides,
  };
}

function reviewAgentInput(project, toolUseId) {
  return agentInput(project, {
    tool_use_id: toolUseId,
    args: {
      agentName: 'pipeline-adversarial-quality',
      prompt: 'review safely',
      description: 'Quality review agent',
    },
  });
}

function fakeClient() {
  const calls = [];
  return {
    calls,
    trace(payload) {
      calls.push({ method: 'trace', payload });
      return {
        span: (spanPayload) => {
          calls.push({ method: 'trace.span', payload: spanPayload });
          return {
            end: (endPayload) => calls.push({ method: 'trace.span.end', payload: endPayload }),
          };
        },
      };
    },
    span(payload) {
      calls.push({ method: 'span', payload });
      return {
        end: (endPayload) => calls.push({ method: 'span.end', payload: endPayload }),
      };
    },
  };
}

const originalEnabled = process.env.LANGFUSE_ENABLED;
const originalSample = process.env.LANGFUSE_SAMPLE_RATE;
const originalPublicKey = process.env.LANGFUSE_PUBLIC_KEY;
const originalSecretKey = process.env.LANGFUSE_SECRET_KEY;
const originalOpenAiKey = process.env.OPENAI_API_KEY;
const originalConsent = process.env.LANGFUSE_CONSENT_DECISION;
const originalGateEvent = process.env.LANGFUSE_GATE_EVENT_ID;

try {
  delete process.env.LANGFUSE_ENABLED;
  delete process.env.LANGFUSE_SAMPLE_RATE;

  const noStateProject = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w6-2-no-state-'));
  const disabledClient = fakeClient();
  let output = {};
  langfuse.handleToolExecuteBefore(agentInput(noStateProject), output, { client: disabledClient });
  assert.equal(disabledClient.calls.length, 0);
  assert.equal(output.error, undefined);
  assert.equal(output.warning, undefined);

  const governed = projectWithState(sentinel());
  process.env.LANGFUSE_ENABLED = 'true';
  process.env.LANGFUSE_SAMPLE_RATE = '1';

  const noConsentClient = fakeClient();
  langfuse.handleToolExecuteBefore(agentInput(governed.project, { tool_use_id: 'dispatch-no-consent' }), {}, {
    client: noConsentClient,
    carrierRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'po-w6-2-no-consent-')),
    nowIso: '2026-06-23T12:59:00.000Z',
    random: () => 0,
  });
  assert.equal(noConsentClient.calls.length, 0);

  process.env.LANGFUSE_CONSENT_DECISION = 'approved';
  process.env.LANGFUSE_GATE_EVENT_ID = 'gate-langfuse-test';

  const carrierRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'po-w6-2-carrier-'));
  const client = fakeClient();
  output = {};
  langfuse.handleToolExecuteBefore(agentInput(governed.project), output, {
    client,
    carrierRoot,
    nowIso: '2026-06-23T13:00:00.000Z',
    random: () => 0,
  });

  assert.equal(output.error, undefined);
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls[0].method, 'trace');
  assert.equal(client.calls[0].payload.name, 'pipeline-run:run-langfuse');
  assert.equal(client.calls[0].payload.metadata.run_id, 'run-langfuse');
  assert.equal(client.calls[0].payload.metadata.phase, 'phase_5_to_6');
  assert.equal(client.calls[0].payload.metadata.type, 'feature');
  assert.equal(client.calls[0].payload.metadata.complexity, 'medium');
  assert.equal(client.calls[1].method, 'trace.span');
  assert.equal(client.calls[1].payload.name, 'pipeline-implementer');
  assert.equal(client.calls[1].payload.startTime, '2026-06-23T13:00:00.000Z');
  assert.match(client.calls[1].payload.input, /\[REDACTED(?:_SECRET)?\]/);
  assert.equal(client.calls[1].payload.metadata.agent_name, 'pipeline-implementer');

  langfuse.handleToolExecuteAfter({ ...agentInput(governed.project), tool_response: { ok: true, token: 'abc123' } }, {}, {
    client,
    carrierRoot,
    nowIso: '2026-06-23T13:00:00.000Z',
  });
  assert.equal(client.calls.at(-1).method, 'span.end');
  assert.equal(client.calls.at(-1).payload.endTime, '2026-06-23T13:00:00.001Z');
  assert.equal(client.calls.at(-1).payload.metadata.duration_ms, 1);
  assert.match(client.calls.at(-1).payload.output, /\[REDACTED(?:_SECRET)?\]/);

  const stateGone = projectWithState(sentinel({ runId: 'run-state-gone' }));
  const stateGoneClient = fakeClient();
  langfuse.handleToolExecuteBefore(agentInput(stateGone.project, { tool_use_id: 'dispatch-state-gone' }), {}, {
    client: stateGoneClient,
    carrierRoot,
    nowIso: '2026-06-23T13:00:02.000Z',
  });
  fs.rmSync(path.join(stateGone.project, '.pipeline', 'active-run.json'), { force: true });
  langfuse.handleToolExecuteAfter({ ...agentInput(stateGone.project, { tool_use_id: 'dispatch-state-gone' }), tool_response: 'done' }, {}, {
    client: stateGoneClient,
    carrierRoot,
    nowIso: '2026-06-23T13:00:03.000Z',
  });
  assert.equal(stateGoneClient.calls.some((call) => call.method === 'span.end'), true);

  const tamperedClient = fakeClient();
  langfuse.handleToolExecuteBefore(agentInput(governed.project, { tool_use_id: 'dispatch-tampered' }), {}, {
    client: tamperedClient,
    carrierRoot,
    nowIso: '2026-06-23T13:00:05.000Z',
  });
  const tamperedPath = langfuse.spanCarrierPath('run-langfuse', 'dispatch-tampered', { carrierRoot });
  const tamperedCarrier = JSON.parse(fs.readFileSync(tamperedPath, 'utf8'));
  tamperedCarrier.traceId = 'trace-forged';
  tamperedCarrier.agentName = 'evil-agent';
  fs.writeFileSync(tamperedPath, JSON.stringify(tamperedCarrier));
  const callsBeforeTamperedClose = tamperedClient.calls.length;
  langfuse.handleToolExecuteAfter({ ...agentInput(governed.project, { tool_use_id: 'dispatch-tampered' }), tool_response: 'done' }, {}, {
    client: tamperedClient,
    carrierRoot,
    nowIso: '2026-06-23T13:00:06.000Z',
  });
  assert.equal(tamperedClient.calls.length, callsBeforeTamperedClose);
  fs.unlinkSync(tamperedPath);

  const precreatedClient = fakeClient();
  const precreatedPath = langfuse.spanCarrierPath('run-langfuse', 'dispatch-precreated', { carrierRoot });
  fs.writeFileSync(precreatedPath, '{"forged":true}', { flag: 'w' });
  langfuse.handleToolExecuteBefore(agentInput(governed.project, { tool_use_id: 'dispatch-precreated' }), {}, {
    client: precreatedClient,
    carrierRoot,
    nowIso: '2026-06-23T13:00:10.000Z',
  });
  assert.equal(precreatedClient.calls.length, 0);
  fs.unlinkSync(precreatedPath);

  const forgedClient = fakeClient();
  const forgedPath = langfuse.spanCarrierPath('run-langfuse', 'dispatch-forged', { carrierRoot });
  fs.writeFileSync(forgedPath, JSON.stringify({ traceId: 'trace-forged', spanId: 'span-forged', runId: 'run-langfuse', nonce: 'fake', startedAt: '2026-06-23T13:00:00.000Z', agentName: 'evil' }));
  langfuse.handleToolExecuteAfter({ ...agentInput(governed.project, { tool_use_id: 'dispatch-forged' }), tool_response: 'secret=abc123' }, {}, {
    client: forgedClient,
    carrierRoot,
    nowIso: '2026-06-23T13:00:11.000Z',
  });
  assert.equal(forgedClient.calls.length, 0);
  fs.unlinkSync(forgedPath);

  const secretRun = projectWithState(sentinel({ runId: 'run-secret password=abc123' }));
  const secretNameClient = fakeClient();
  const secretAuditEvents = [];
  langfuse.handleToolExecuteBefore(agentInput(secretRun.project, {
    tool_use_id: 'dispatch-secret-name',
    args: { agentName: 'pipeline-implementer token=abc123', prompt: 'safe' },
  }), {}, {
    client: secretNameClient,
    carrierRoot,
    nowIso: '2026-06-23T13:00:20.000Z',
    audit: (event) => secretAuditEvents.push(event),
  });
  assert.match(secretNameClient.calls[0].payload.name, /\[REDACTED(?:_SECRET)?\]/);
  assert.match(secretNameClient.calls[1].payload.name, /\[REDACTED(?:_SECRET)?\]/);
  const secretCarrierPath = langfuse.spanCarrierPath('run-secret password=abc123', 'dispatch-secret-name', { carrierRoot });
  assert.equal(fs.readFileSync(secretCarrierPath, 'utf8').includes('abc123'), false);
  assert.equal(JSON.stringify(secretAuditEvents).includes('abc123'), false);

  assert.doesNotThrow(() => langfuse.handleToolExecuteBefore(agentInput(governed.project, { tool_use_id: 'dispatch-audit-open' }), {}, {
    client: fakeClient(),
    carrierRoot,
    nowIso: '2026-06-23T13:00:30.000Z',
    audit: () => { throw new Error('audit failed'); },
  }));
  assert.doesNotThrow(() => langfuse.handleToolExecuteAfter({ ...agentInput(governed.project, { tool_use_id: 'dispatch-audit-open' }), tool_response: 'done' }, {}, {
    client: fakeClient(),
    carrierRoot,
    nowIso: '2026-06-23T13:00:31.000Z',
    audit: () => { throw new Error('audit failed'); },
  }));

  const originalLoad = Module._load;
  const defaultClientCalls = [];
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'langfuse') {
      return class FakeLangfuse {
        trace(payload) {
          defaultClientCalls.push({ method: 'trace', payload });
          return { span: (spanPayload) => defaultClientCalls.push({ method: 'trace.span', payload: spanPayload }) };
        }
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    process.env.LANGFUSE_PUBLIC_KEY = 'public-test-key';
    process.env.LANGFUSE_SECRET_KEY = 'secret-test-value';
    process.env.OPENAI_API_KEY = 'env-secret-value-12345';
    langfuse.handleToolExecuteBefore(agentInput(governed.project, { tool_use_id: 'dispatch-default-client' }), {}, {
      carrierRoot,
      nowIso: '2026-06-23T13:00:40.000Z',
    });
    assert.equal(defaultClientCalls.some((call) => call.method === 'trace.span'), true);
    langfuse.handleToolExecuteBefore(agentInput(governed.project, {
      tool_use_id: 'dispatch-env-secret',
      args: { agentName: 'pipeline-implementer', prompt: 'env-secret-value-12345' },
    }), {}, {
      carrierRoot,
      nowIso: '2026-06-23T13:00:41.000Z',
    });
    assert.equal(JSON.stringify(defaultClientCalls).includes('env-secret-value-12345'), false);
  } finally {
    Module._load = originalLoad;
  }

  const skipped = fakeClient();
  process.env.LANGFUSE_SAMPLE_RATE = '0';
  langfuse.handleToolExecuteBefore(agentInput(governed.project, { tool_use_id: 'dispatch-skip' }), {}, {
    client: skipped,
    carrierRoot,
    nowIso: '2026-06-23T13:01:00.000Z',
    random: () => 0.99,
  });
  assert.equal(skipped.calls.length, 0);
  langfuse.handleToolExecuteAfter(agentInput(governed.project, { tool_use_id: 'dispatch-skip', tool_response: 'done' }), {}, { client: skipped, carrierRoot });
  assert.equal(skipped.calls.length, 0);

  process.env.LANGFUSE_SAMPLE_RATE = '1';
  output = {};
  langfuse.handleToolExecuteBefore({ cwd: governed.project, tool: 'bash', args: { command: 'npm test' } }, output, { client: fakeClient(), carrierRoot });
  assert.equal(output.error, undefined);

  const hooks = langfuse.createLangfuseHooks({ client: fakeClient(), carrierRoot, nowIso: '2026-06-23T13:02:00.000Z' });
  assert.equal(typeof hooks['tool.execute.before'], 'function');
  assert.equal(typeof hooks['tool.execute.after'], 'function');

  const pluginClient = fakeClient();
  const pluginHooks = plugin.createPipelineAdaptationHooks({ directory: governed.project }, {
    client: pluginClient,
    carrierRoot,
    nowIso: '2026-06-23T13:03:00.000Z',
  });
  pluginHooks['tool.execute.before'](reviewAgentInput(governed.project, 'dispatch-plugin'), {});
  pluginHooks['tool.execute.after']({ ...reviewAgentInput(governed.project, 'dispatch-plugin'), tool_response: 'done' }, {});
  assert.equal(pluginClient.calls.some((call) => call.method === 'trace.span'), true);
  assert.equal(pluginClient.calls.some((call) => call.method === 'span.end'), true);

  assert.equal(typeof opencodeIndex.createLangfuseHooks, 'function');

  async function assertOpenCodePluginFileRegistersLangfuse() {
    const pluginFile = path.join(__dirname, '..', '..', '.opencode', 'plugins', 'pipeline-adaptation-plugin.js');
    const pluginModule = await import(pathToFileURL(pluginFile).href);
    const fileClient = fakeClient();
    const hooksFromFile = await pluginModule.default({ directory: governed.project }, {
      client: fileClient,
      carrierRoot,
      env: { LANGFUSE_ENABLED: 'true', LANGFUSE_SAMPLE_RATE: '1', LANGFUSE_CONSENT_DECISION: 'approved', LANGFUSE_GATE_EVENT_ID: 'gate-langfuse-file' },
      nowIso: '2026-06-23T13:04:00.000Z',
    });
    hooksFromFile['tool.execute.before'](reviewAgentInput(governed.project, 'dispatch-file'), {});
    hooksFromFile['tool.execute.after']({ ...reviewAgentInput(governed.project, 'dispatch-file'), tool_response: 'done' }, {});
    assert.equal(fileClient.calls.some((call) => call.method === 'trace.span'), true);
    assert.equal(fileClient.calls.some((call) => call.method === 'span.end'), true);
  }

  assertOpenCodePluginFileRegistersLangfuse()
    .then(() => console.log('langfuse hook OK'))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
} finally {
  if (originalEnabled === undefined) delete process.env.LANGFUSE_ENABLED;
  else process.env.LANGFUSE_ENABLED = originalEnabled;
  if (originalSample === undefined) delete process.env.LANGFUSE_SAMPLE_RATE;
  else process.env.LANGFUSE_SAMPLE_RATE = originalSample;
  if (originalPublicKey === undefined) delete process.env.LANGFUSE_PUBLIC_KEY;
  else process.env.LANGFUSE_PUBLIC_KEY = originalPublicKey;
  if (originalSecretKey === undefined) delete process.env.LANGFUSE_SECRET_KEY;
  else process.env.LANGFUSE_SECRET_KEY = originalSecretKey;
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
  if (originalConsent === undefined) delete process.env.LANGFUSE_CONSENT_DECISION;
  else process.env.LANGFUSE_CONSENT_DECISION = originalConsent;
  if (originalGateEvent === undefined) delete process.env.LANGFUSE_GATE_EVENT_ID;
  else process.env.LANGFUSE_GATE_EVENT_ID = originalGateEvent;
}
