import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createPipelineGuardHooks } = require('../../src/opencode/plugin-guard.cjs');

// `options.getActiveRun()` returns the active run descriptor. For the Plan-Mode gate (v0.2.0) it
// SHOULD include `planGate` (read from loadSentinel().planGate) alongside `allowedSurfaces`; when
// `planGate` is absent the guard falls back to legacy behavior (no plan enforcement, back-compat).
export const PipelineGuard = async function pipelineGuardPlugin(_input = {}, options = {}) {
  return createPipelineGuardHooks({
    getActiveRun: options.getActiveRun || (() => null),
    audit: options.audit || (() => {}),
  });
};

export default PipelineGuard;
