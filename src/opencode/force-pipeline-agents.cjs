'use strict';

const { extractPrompt } = require('./pipeline-arm-writer.cjs');

const PROMPT_APPEND_EVENT = 'tui.prompt.append';

const PIPELINE_COMMAND_PATTERNS = Object.freeze([
  /^\/(pipeline|feature-light|feature-heavy|bugfix-light|bugfix-heavy|audit-light|audit-heavy|ux-light|ux-heavy|spec-light|spec-heavy)\b/i,
  /^\/pipeline-orchestrator:(pipeline|bugfix|feature|userstory|audit|ux|spec)\b/i,
]);

const SKILL_COMMAND_PATTERNS = Object.freeze([
  /^\/(context|commit|code-review|fix|verify|deploy|qa|test)\b/i,
  /^\/kiro:/i,
  /^\/prompts:/i,
]);

const IMPLEMENTATION_PATTERNS = Object.freeze([
  /\b(fix|corrig|arrum|consert|resolv)\b/i,
  /\b(implement|criar|crie|adicion|add|desenvolv)\b/i,
  /\b(alter|modific|mud|atualiz|updat)\b/i,
  /\b(remov|delet|exclu|apag)\b/i,
  /\b(refator|refactor|reescrev|rewrite)\b/i,
  /\b(configur|setup|instal)\b/i,
  /\b(migr|convert|transform)\b/i,
  /\b(bug|erro|error|fail|falha|quebr|broken|crash)\b/i,
  /\b(nao funciona|não funciona|not working|doesn't work)\b/i,
  /\b(feature|funcionalidade|novo|nova|new)\b/i,
  /\b(botao|botão|button|tela|screen|pagina|página|page|componente|component)\b/i,
]);

const PIPELINE_WORTHY_PATTERNS = Object.freeze([
  /\b(analise|analisar|auditar|auditoria|revisar|verificar|investigar|diagnostic|causa raiz|root cause)\b/i,
  /\b(pipeline|agentes|orquestrador|orchestrator|classifier|executor|observabilidade|logs|tracing|correlation|runlog)\b/i,
  /\b(nao esta funcionando|não está funcionando|nao funciona|não funciona)\b/i,
]);

const ENFORCEMENT_MESSAGE = [
  'PIPELINE DE AGENTES OBRIGATORIO',
  '',
  'Esta solicitacao parece trabalho de implementacao no subset local OpenCode.',
  'Use o Pipeline Orchestrator local antes de implementar.',
  '',
  'Obrigatorio:',
  '- Disparar pipeline-run-orchestrator ou a skill pipeline-orchestrator.',
  '- Aguardar ORCHESTRATOR_DECISION antes de editar codigo.',
  '- Registrar acceptance, RED, GREEN, prompt result, review result e final verdict.',
  '- Nao implemente inline enquanto o run governado estiver ativo.',
  '',
  'Nota: isto nao afirma paridade total com o plugin Claude Code; e apenas a adaptacao local OpenCode.',
].join('\n');

const PIPELINE_SKILL_MESSAGE = [
  'FASES OBRIGATORIAS DO PIPELINE LOCAL OPENCODE',
  '',
  'Entrada pipeline detectada.',
  'Nao pule gates de seguranca, escopo, TDD, revisao e evidencia.',
  'Use agentes pipeline e registre decisoes estruturadas quando houver escolha do usuario.',
  'Stop handling neste subset e observer-only; nao trate idle/stop como conclusao automatica.',
].join('\n');

const SUGGESTION_MESSAGE = 'Considere usar o Pipeline Orchestrator local se esta solicitacao virar trabalho de codigo, revisao, investigacao ou mudanca de escopo.';

function normalizePrompt(prompt) {
  return String(prompt || '').trim();
}

function isTrivialChat(prompt) {
  const trimmed = normalizePrompt(prompt);
  if (!trimmed) return true;
  return /^(oi|ola|olá|hey|hi|hello|obrigado|valeu|ok|entendi|certo|sim|nao|não|bom dia|boa tarde|boa noite)$/i.test(trimmed);
}

function matchesAny(prompt, patterns) {
  const trimmed = normalizePrompt(prompt);
  return patterns.some((pattern) => pattern.test(trimmed));
}

function isPipelineCommand(prompt) {
  return matchesAny(prompt, PIPELINE_COMMAND_PATTERNS);
}

function isSkillCommand(prompt) {
  return isPipelineCommand(prompt) || matchesAny(prompt, SKILL_COMMAND_PATTERNS);
}

function isImplementationRequest(prompt) {
  return matchesAny(prompt, IMPLEMENTATION_PATTERNS);
}

function isPipelineWorthy(prompt) {
  const trimmed = normalizePrompt(prompt);
  if (!trimmed) return false;
  if (isImplementationRequest(trimmed)) return true;
  if (trimmed.length >= 140) return true;
  return matchesAny(trimmed, PIPELINE_WORTHY_PATTERNS);
}

function setSystemMessage(output, message) {
  if (!message || !output || typeof output !== 'object') return output;
  const existing = output.systemMessage || output.system_message || '';
  output.systemMessage = existing ? `${existing}\n\n${message}` : message;
  return output;
}

function decidePromptMessage(prompt) {
  const trimmed = normalizePrompt(prompt);
  if (isTrivialChat(trimmed)) return null;
  if (isPipelineCommand(trimmed)) return PIPELINE_SKILL_MESSAGE;
  if (isSkillCommand(trimmed)) return null;
  if (isPipelineWorthy(trimmed)) return ENFORCEMENT_MESSAGE;
  return SUGGESTION_MESSAGE;
}

function audit(options, event) {
  if (options && typeof options.audit === 'function') {
    try { options.audit(event); } catch (_) { /* observer only */ }
  }
}

function handlePromptAppend(input = {}, output = {}, options = {}) {
  const prompt = extractPrompt(input);
  const message = decidePromptMessage(prompt);
  if (message) {
    setSystemMessage(output, message);
    audit(options, { type: 'force-pipeline-agents.injected' });
  } else {
    audit(options, { type: 'force-pipeline-agents.ignored' });
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

function createForcePipelineAgentsHooks(options = {}) {
  return {
    [PROMPT_APPEND_EVENT]: (input, output = {}) => handlePromptAppend(input, output, options),
    event: (input, output = {}) => handleEvent(input, output, options),
  };
}

module.exports = {
  PROMPT_APPEND_EVENT,
  PIPELINE_COMMAND_PATTERNS,
  SKILL_COMMAND_PATTERNS,
  IMPLEMENTATION_PATTERNS,
  PIPELINE_WORTHY_PATTERNS,
  ENFORCEMENT_MESSAGE,
  PIPELINE_SKILL_MESSAGE,
  SUGGESTION_MESSAGE,
  normalizePrompt,
  isTrivialChat,
  matchesAny,
  isPipelineCommand,
  isSkillCommand,
  isImplementationRequest,
  isPipelineWorthy,
  setSystemMessage,
  decidePromptMessage,
  handlePromptAppend,
  handleEvent,
  createForcePipelineAgentsHooks,
};
