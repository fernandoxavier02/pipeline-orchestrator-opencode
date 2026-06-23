# W5.2 Spec Seal Guard Evidence

## Scope

- Slice: W5.2 `src/opencode/spec-seal-guard.cjs`
- Goal: block repo-local OpenCode `run-seal.cjs` execution when `spec_review_done !== true`.
- Boundary: local OpenCode adaptation only. This does not claim full Claude Code parity and does not prove the user's currently installed global OpenCode config has been refreshed.

## Acceptance

- Blocks bash/powershell commands invoking `run-seal.cjs` when the run state is missing `spec_review_done: true`.
- Allows seal when `spec_review_done: true` is present in object or JSON-string notes.
- Fails closed when sentinel state is missing, corrupt, or invalid.
- Checks every `run-seal.cjs` invocation in one shell command, so a reviewed run cannot mask an unreviewed run.
- Registers through the repo-local pipeline adaptation plugin and public OpenCode index.

## RED

Initial command:

```text
node tests/unit/spec-seal-guard.test.cjs
```

Initial result before implementation:

```text
Error: Cannot find module '../../src/opencode/spec-seal-guard.cjs'
```

Adversarial RED after first implementation:

```text
TypeError: Cannot read properties of undefined (reading 'code')
```

Cases that reproduced the issue:

```text
echo run-seal.cjs && node lib/run-seal.cjs "<runDir>" --variant spec-authoring
node lib/run-seal.cjs "<runDir>" && echo run-seal.cjs
node lib/run-seal.cjs "<reviewedRunDir>" && node lib/run-seal.cjs "<unreviewedRunDir>"
```

## GREEN

Focused command:

```text
node tests/unit/spec-seal-guard.test.cjs
```

Focused result:

```text
spec seal guard OK
```

Full command:

```text
npm test
```

Full result:

```text
Summary: 79 passed / 0 failed / 79 total
```

## Fixes Applied

- Added repo-local `spec-seal-guard` for `tool.execute.before`.
- Wired the guard into the pipeline adaptation plugin and OpenCode index exports.
- Added command parsing for quoted run directories, `--`, unknown flags, and flags with values.
- Switched from single-run extraction to checking every `run-seal.cjs` invocation in a command.
- Fails closed on missing/corrupt sentinel state with `SPEC_AUTHORING_STATE_UNTRUSTED`.
- Preserves warn mode while surfacing audit write failure through `auditFailed`.

## Adversarial Review

Initial security review: NO-GO.

Main blockers found:

- Fake `run-seal.cjs` text could mask a real seal command.
- Missing/corrupt sentinel state initially failed open.
- Multiple seal invocations in one command could let a reviewed run mask an unreviewed run.
- Warn mode did not surface audit write failure.

Final security review: GO for W5.2 scope.

Final quality review: GO for code, tests, repo-local plugin registration, and index export.

## Residual Risk

- The user's current global OpenCode install may still be stale until the package is reinstalled or copied into that config.
- This is a local hook-level guard. It does not replace the later W10 `run-seal.cjs` hardening work.
- The command parser is intentionally conservative and may block unusual shell commands that mention `run-seal.cjs` with an absolute path, but the reviewed residual risk is false positive rather than unsafe allow.
