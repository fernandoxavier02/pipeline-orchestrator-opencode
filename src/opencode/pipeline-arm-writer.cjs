'use strict';

const { writeArmPending } = require('../lib/pipeline-arm.cjs');

const PROMPT_APPEND_EVENT = 'tui.prompt.append';

function resolveProjectDir(input, options = {}) {
  if (typeof options.projectDir === 'function') return options.projectDir(input);
  if (typeof options.projectDir === 'string' && options.projectDir) return options.projectDir;
  if (input && typeof input.cwd === 'string' && input.cwd) return input.cwd;
  if (input && typeof input.directory === 'string' && input.directory) return input.directory;
  if (input && input.project && typeof input.project.root === 'string' && input.project.root) return input.project.root;
  if (input && input.project && typeof input.project.directory === 'string' && input.project.directory) return input.project.directory;
  return null;
}

function contentToString(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part.text === 'string') return part.text;
      if (part && typeof part.content === 'string') return part.content;
      return '';
    }).join('');
  }
  return '';
}

function extractPrompt(input) {
  if (typeof input === 'string') return input;
  if (!input || typeof input !== 'object') return '';

  for (const key of ['prompt', 'input', 'text']) {
    if (typeof input[key] === 'string') return input[key];
  }
  if (typeof input.message === 'string') return input.message;
  if (input.message && typeof input.message === 'object') {
    const value = contentToString(input.message.content || input.message.text);
    if (value) return value;
  }
  if (Array.isArray(input.messages)) {
    for (let i = input.messages.length - 1; i >= 0; i -= 1) {
      const message = input.messages[i];
      if (!message || typeof message !== 'object') continue;
      if (message.role && message.role !== 'user') continue;
      const value = contentToString(message.content || message.text);
      if (value) return value;
    }
  }
  if (input.args && typeof input.args.prompt === 'string') return input.args.prompt;
  if (input.properties && typeof input.properties.prompt === 'string') return input.properties.prompt;
  if (input.properties && typeof input.properties.text === 'string') return input.properties.text;
  return '';
}

function audit(options, event) {
  if (options && typeof options.audit === 'function') {
    try { options.audit(event); } catch { /* ignore observer failure */ }
  }
}

function handlePromptAppend(input = {}, output = {}, options = {}) {
  try {
    const prompt = extractPrompt(input);
    const cwd = resolveProjectDir(input, options);
    if (!cwd) {
      audit(options, { type: 'pipeline-arm.writer.ignored', reason: 'missing_project_dir' });
      return output;
    }
    const writer = options.writeArmPending || writeArmPending;
    const marker = writer(cwd, prompt, options.nowIso);
    if (marker) audit(options, { type: 'pipeline-arm.writer.armed', workflow: marker.workflow });
    else audit(options, { type: 'pipeline-arm.writer.ignored' });
  } catch (err) {
    audit(options, { type: 'pipeline-arm.writer.error', error: err && err.name ? err.name : 'Error' });
  }
  return output;
}

function handleEvent(input = {}, output = {}, options = {}) {
  const event = input && input.event;
  if (!event || event.type !== PROMPT_APPEND_EVENT) return output;
  return handlePromptAppend({
    ...(event.properties || event),
    cwd: input.cwd,
    directory: input.directory,
    project: input.project,
  }, output, options);
}

function createPipelineArmWriterHooks(options = {}) {
  return {
    [PROMPT_APPEND_EVENT]: (input, output = {}) => handlePromptAppend(input, output, options),
    event: (input, output = {}) => handleEvent(input, output, options),
  };
}

module.exports = {
  PROMPT_APPEND_EVENT,
  resolveProjectDir,
  extractPrompt,
  handlePromptAppend,
  handleEvent,
  createPipelineArmWriterHooks,
};
