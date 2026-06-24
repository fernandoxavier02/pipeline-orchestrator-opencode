# W7.1 Stop Gate Pattern Review Record

## Security Review

Initial result: NO-GO.

Findings:

- Lock behavior could wait too long during observer teardown.
- Continuity counter was not fully protected inside the lock.
- Audit event could be written before state persistence.

Fixes:

- Lock uses a single attempt with no retry.
- Counter is calculated and written inside the state mutation.
- Protocol event is written only after successful persistence.

Rereview result: GO.

## Quality Review

Initial result after repo-local tests: NO-GO.

Finding:

- Global OpenCode plugin was stale and returned no hooks.
- Global OpenCode skill was missing the W7.1 observer-only rule.

Fixes:

- Global plugin now loads the repo-local `createPipelineAdaptationHooks` implementation.
- Global skill now includes the W7.1 `PIPELINE_STOP_ATTEMPT` observer-only rule.
- Global plugin load was verified and returned the expected hook names.

Final adversarial quality result:

- No code blocker found.
- Evidence artifacts were required before final GO.

Final decision after adding evidence, prompt log, and review record: GO.

## Residual Risk

The OpenCode adaptation cannot deterministically block session stop. W7.1 mitigates this by recording attempts and failing the run after repeated continuity attempts, but it is not full Claude Code stop-hook parity.
