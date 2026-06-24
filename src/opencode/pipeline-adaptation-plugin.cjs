'use strict';

const { createPipelineArmGateHooks } = require('./pipeline-arm-gate.cjs');
const { createPipelineArmWriterHooks } = require('./pipeline-arm-writer.cjs');
const { createStepLedgerGateHooks } = require('./step-ledger-gate.cjs');
const { createStepLedgerStampHooks } = require('./step-ledger-stamp.cjs');
const { createBatchReviewGateHooks } = require('./batch-review-gate.cjs');
const { createCheckpointVerdictGateHooks } = require('./checkpoint-verdict-gate.cjs');
const { createPhaseVerdictGateHooks } = require('./phase-verdict-gate.cjs');
const { createGateLogGateHooks } = require('./gate-log-gate.cjs');
const { createDispatchPendingGateHooks } = require('./dispatch-pending-gate.cjs');
const { createDispatchRecordHooks } = require('./dispatch-record-hook.cjs');
const { createScopeLockHooks } = require('./scope-lock-hook.cjs');
const { createSpecSealGuardHooks } = require('./spec-seal-guard.cjs');
const { createParallelDispatchGateHooks } = require('./parallel-dispatch-gate.cjs');
const { createHumanGateRecordHooks } = require('./human-gate-record.cjs');
const { createLangfuseHooks } = require('./langfuse-hook.cjs');
const { createStopGatePatternHooks } = require('./stop-gate-pattern.cjs');
const { createStopHookHooks } = require('./stop-hook.cjs');
const { createSessionCleanupHooks } = require('./session-cleanup-hook.cjs');

function projectDirFromContext(ctx = {}) {
  if (typeof ctx.worktree === 'string' && ctx.worktree) return ctx.worktree;
  if (typeof ctx.directory === 'string' && ctx.directory) return ctx.directory;
  if (ctx.project && typeof ctx.project.root === 'string' && ctx.project.root) return ctx.project.root;
  if (ctx.project && typeof ctx.project.directory === 'string' && ctx.project.directory) return ctx.project.directory;
  return null;
}

function createPipelineAdaptationHooks(ctx = {}, options = {}) {
  const projectDir = options.projectDir || projectDirFromContext(ctx);
  return mergeHooks(
    createPipelineArmWriterHooks({ ...options, projectDir }),
    createPipelineArmGateHooks({ ...options, projectDir }),
    createDispatchPendingGateHooks({ ...options, projectDir }),
    createParallelDispatchGateHooks({ ...options, projectDir }),
    createScopeLockHooks({ ...options, projectDir }),
    createSpecSealGuardHooks({ ...options, projectDir }),
    createStepLedgerGateHooks({ ...options, projectDir }),
    createGateLogGateHooks({ ...options, projectDir }),
    createBatchReviewGateHooks({ ...options, projectDir }),
    createCheckpointVerdictGateHooks({ ...options, projectDir }),
    createPhaseVerdictGateHooks({ ...options, projectDir }),
    createDispatchRecordHooks({ ...options, projectDir }),
    createStepLedgerStampHooks({ ...options, projectDir }),
    createHumanGateRecordHooks({ ...options, projectDir }),
    createLangfuseHooks({ ...options, projectDir }),
    createStopGatePatternHooks({ ...options, projectDir }),
    createStopHookHooks({ ...options, projectDir }),
    createSessionCleanupHooks({ ...options, projectDir }),
  );
}

function mergeHooks(...hookMaps) {
  const merged = {};
  for (const hooks of hookMaps) {
    for (const [name, hook] of Object.entries(hooks || {})) {
      if (typeof hook !== 'function') {
        merged[name] = hook;
        continue;
      }
      const previous = merged[name];
      if (typeof previous !== 'function') {
        merged[name] = hook;
        continue;
      }
      merged[name] = (input, output = {}) => {
        previous(input, output);
        if (!output.error) hook(input, output);
        return output;
      };
    }
  }
  return merged;
}

module.exports = {
  mergeHooks,
  projectDirFromContext,
  createPipelineAdaptationHooks,
};
