# W8.1 Dispatch Guard Review

## First Adversarial Review

Security verdict: BLOCK.

Findings:

- First Plan-Mode protected dispatch was allowed without `PLAN_MODE_RESULTS`.
- Hook output could override target/prompt before guard decision.
- Marker/event writers trusted `runDir` without their own containment check.

Quality verdict: BLOCK.

Findings:

- Missing W8.1 evidence package.
- Test coverage too thin for runtime guard.
- Installed wrapper hook exposure not proven.

## Remediation

- Block protected dispatch immediately when `PLAN_MODE_RESULTS` is missing.
- Detect and block output mutation of dispatch target/prompt.
- Validate run directory is inside the project pipeline directory before marker/event writes.
- Expand unit tests for corrupt state, inactive pipeline, warning mode, input variants, stale markers, path escape, output mutation, and wrapper smoke.
- Add evidence, prompt log, and review record files.

## Verification After Remediation

```text
node tests/unit/dispatch-guard.test.cjs
dispatch guard OK

node tests/unit/global-install.test.cjs
global install OK

npm test
Summary: 88 passed / 0 failed / 88 total
```

## Final Status

Second adversarial review returned BLOCK.

Findings:

- Real OpenCode names were not all covered.
- Plan-Mode warning could prevent STEP 1.7 block from winning.
- Output could inject a target when the original input had none.
- Plugin composition made dispatch guard override older specific gate errors.

Second remediation:

- Apply Plan-Mode and STEP 1.7 checks to canonical agent leaves, covering OpenCode aliases.
- Continue evaluating STEP 1.7 after a Plan-Mode warning; blocks win over warnings.
- Block output target/prompt injection when the original dispatch input had none.
- Move dispatch guard after specific gates in plugin composition.
- Add regression tests for real aliases, combined warning/block behavior, injection, and affected older gates.

Verification after second remediation:

```text
node tests/unit/gate-log-gate.test.cjs
gate log gate OK

node tests/unit/phase-verdict-gate.test.cjs
phase verdict gate OK

node tests/unit/parallel-dispatch-gate.test.cjs
parallel dispatch gate OK

node tests/unit/dispatch-guard.test.cjs
dispatch guard OK

npm test
Summary: 88 passed / 0 failed / 88 total
```

Ready for third adversarial review.

Third adversarial review results:

- Security verdict: GO.
- Quality verdict: BLOCK due to proof strength, not code behavior.

Quality remediation:

- Added composed plugin conflict test where an older gate and dispatch guard could both block; `GATE_LOG_MISSING` wins.
- Added temporary real install test using this repository's artifacts; installed wrapper imports the real adaptation runtime and blocks `pipeline-planner` without `PLAN_MODE_RESULTS`.

Verification after quality-proof remediation:

```text
node tests/unit/dispatch-guard.test.cjs
dispatch guard OK

npm test
Summary: 88 passed / 0 failed / 88 total
```

Ready for fourth quality review.

Fourth quality review result:

- Quality verdict: GO.
- Blocking findings: none.
- Residual risk: low; real OpenCode manual use is still not fully replaced by automated tests.

Final adversarial status:

- Security: GO.
- Quality: GO.
