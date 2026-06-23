# W5.3 Parallel Dispatch Gate Evidence

## Scope

- Slice: W5.3 `src/opencode/parallel-dispatch-gate.cjs`
- Goal: add a repo-local OpenCode guard for `parallel_dispatch_expected` that warns by default and only hard-denies when enforcement is explicitly enabled and state trust is strong enough.
- Boundary: local OpenCode adaptation only. This does not claim full Claude Code parity and does not prove the user's currently installed global OpenCode config has been refreshed.

## Acceptance

- Allows task/agent dispatch when no active pipeline state exists.
- Allows members listed in `parallel_dispatch_expected.dispatch_ids`.
- Warns and writes audit evidence for out-of-group dispatches while a group is armed.
- Suppresses hard deny for schema-only local state, because the OpenCode subset does not use HMAC trust.
- Allows hard deny only under explicit opt-in plus strong state trust.
- Fails open on missing, corrupt, inactive, malformed-timestamp, or otherwise untrusted state.
- Handles OpenCode-style `output.args` as the effective tool arguments.
- Registers through the repo-local pipeline adaptation plugin and public OpenCode index.

## RED

Command:

```text
node tests/unit/parallel-dispatch-gate.test.cjs
```

Result before implementation:

```text
Error: Cannot find module '../../src/opencode/parallel-dispatch-gate.cjs'
```

## GREEN

Focused command:

```text
node tests/unit/parallel-dispatch-gate.test.cjs
```

Focused result:

```text
parallel dispatch gate OK
```

Full command:

```text
npm test
```

Full result:

```text
Summary: 80 passed / 0 failed / 80 total
```

## Fixes Applied

- Added repo-local `parallel-dispatch-gate` for `tool.execute.before`.
- Wired the guard into the pipeline adaptation plugin and OpenCode index exports.
- Added audit writes for `PARALLEL_DISPATCH_VIOLATION` and `PARALLEL_DISPATCH_MALFORMED`.
- Uses contained active state discovery for audit path resolution instead of trusting raw pointers.
- Reads OpenCode-style `output.args` so mutated tool arguments are evaluated.
- Suppresses deny mode when state is only schema-validated, preserving the subset's trust boundary.

## Adversarial Review

Initial security review: NO-GO.

Main blockers found:

- Audit path could trust an unsafe active-run pointer.
- Deny mode could hard-block based on schema-only state.
- Test did not cover OpenCode-style `output.args`.
- Evidence package was missing.

Remediation:

- Audit path now uses authoritative contained state discovery.
- Deny mode is suppressed unless state is strongly trusted.
- Test now covers `output.args` and imports the repo-local plugin file.
- This evidence file and prompt log record RED, GREEN, review, and verdict.

Final technical review: GO on code and tests; formal GO required evidence files, now added.

## Final Verdict

GO for W5.3 repo-local OpenCode subset after evidence registration.

## Residual Risk

- The user's current global OpenCode install may still be stale until the package is reinstalled or copied into that config.
- This is an efficiency gate, not a correctness/security gate; corrupt or missing state intentionally fails open.
- Because the local OpenCode signer is schema-only, hard deny is suppressed by default even when `PIPELINE_PARALLEL_ENFORCEMENT=deny` is set.
- The tests import the repo-local plugin file, but they do not prove a full live OpenCode runtime execution.
