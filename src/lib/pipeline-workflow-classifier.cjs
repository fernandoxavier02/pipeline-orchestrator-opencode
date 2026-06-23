'use strict';

const { readOnlySet } = require('./read-only-set.cjs');

const MODES = readOnlySet(['FULL', 'DIAGNOSTIC', 'CONTINUE', 'HOTFIX', 'REVIEW-ONLY', 'PAPERCLIP']);
const TYPES = readOnlySet(['Bug Fix', 'Feature', 'User Story', 'Audit', 'UX Simulation', 'Spec']);

function mk(mode, type, variant, complexity, source) {
  return { mode, type, variant, complexity, source };
}

function isPipelineInvocation(rawPrompt) {
  const low = String(rawPrompt || '').trim().toLowerCase();
  return /^\/pipeline-orchestrator:(pipeline|bugfix|feature|userstory|user-story|audit|ux|ux-sim|spec)\b/.test(low)
    || /^\/pipeline\b/.test(low)
    || /^\/(bugfix|feature|audit|ux|ux-sim|spec)(?:-(light|heavy))?\b/.test(low);
}

function classifyWorkflow(rawPrompt) {
  const prompt = String(rawPrompt || '');
  const low = prompt.toLowerCase();
  const has = (pattern) => pattern.test(low);

  if (has(/--on=paperclip\b/)) return mk('PAPERCLIP', null, null, null, 'flag:--on=paperclip');
  if (has(/--hotfix\b/)) return mk('HOTFIX', 'Bug Fix', 'bugfix-heavy', 'COMPLEXA', 'flag:--hotfix');
  if (has(/\breview-only\b/) && isPipelineInvocation(prompt)) return mk('REVIEW-ONLY', null, null, null, 'flag:review-only');
  if (has(/\bdiagnostic\b/) && isPipelineInvocation(prompt)) return mk('DIAGNOSTIC', null, null, null, 'flag:diagnostic');
  if (has(/\bcontinue\b/) && isPipelineInvocation(prompt)) return mk('CONTINUE', null, null, null, 'flag:continue');

  let complexity = null;
  if (has(/--complexa\b/)) complexity = 'COMPLEXA';
  else if (has(/--media\b/)) complexity = 'MEDIA';
  else if (has(/--simples\b/)) complexity = 'SIMPLES';

  let variant = null;
  const variantMatch = low.match(/--variant=([a-z][a-z0-9-]*)/);
  if (variantMatch) variant = variantMatch[1];
  else if (has(/--heavy\b/)) variant = 'heavy';
  else if (has(/--light\b/)) variant = 'light';

  let type = null;
  let source = 'heuristic:unclassified';
  const commandMatch = low.trim().match(/^\/(bugfix|feature|audit|ux|ux-sim|spec)(?:-(light|heavy))?\b/);
  if (commandMatch) {
    const commandType = commandMatch[1];
    if (!variant && commandMatch[2]) variant = commandMatch[2];
    if (commandType === 'bugfix') { type = 'Bug Fix'; source = 'cmd:/bugfix'; }
    else if (commandType === 'feature') { type = 'Feature'; source = 'cmd:/feature'; }
    else if (commandType === 'audit') { type = 'Audit'; source = 'cmd:/audit'; }
    else if (commandType === 'ux' || commandType === 'ux-sim') { type = 'UX Simulation'; source = 'cmd:/ux'; }
    else if (commandType === 'spec') { type = 'Spec'; source = 'cmd:/spec'; }
  } else if (has(/--type=spec\b/)) { type = 'Spec'; source = 'flag:--type=spec'; }
  else if (has(/--bug[\s-]?fix\b/)) { type = 'Bug Fix'; source = 'flag:--bugfix'; }
  else if (has(/--feature\b/)) { type = 'Feature'; source = 'flag:--feature'; }
  else if (has(/--audit\w*\b/)) { type = 'Audit'; source = 'flag:--audit'; }
  else if (has(/--user[\s-]?story\b/)) { type = 'User Story'; source = 'flag:--userstory'; }
  else if (has(/--ux(?:-?sim)?\b/)) { type = 'UX Simulation'; source = 'flag:--ux'; }
  else if (has(/\bspec\b/)) { type = 'Spec'; source = 'kw:spec'; }
  else if (has(/\b(audit\w*|revis\w*|review\w*|analis\w*|an[aá]lis\w*|investig\w*|diagnostic\w*|causa[\s-]?raiz|root[\s-]?cause)\b/)) { type = 'Audit'; source = 'kw:audit'; }
  else if (has(/\b(bug|erro|error|fix|corrig\w*|consert\w*|quebr\w*|broken|crash|falha|n[aã]o funciona|not working|doesn'?t work)\b/)) { type = 'Bug Fix'; source = 'kw:bugfix'; }
  else if (has(/\b(ux|usabilidade|acessibilidade|wcag|user journey|persona)\b/)) { type = 'UX Simulation'; source = 'kw:ux'; }
  else if (has(/\b(user[\s-]?story|hist[oó]ria de usu[aá]rio|as an? user)\b/)) { type = 'User Story'; source = 'kw:userstory'; }
  else if (has(/\b(feature|funcionalidade|implement\w*|criar|crie|adicion\w*|\badd\b|desenvolv\w*|nova|novo)\b/)) { type = 'Feature'; source = 'kw:feature'; }

  return mk('FULL', type, variant, complexity, source);
}

module.exports = { classifyWorkflow, isPipelineInvocation, MODES, TYPES };
