# W6.1 Human Gate Record Evidence

## Scope

- Slice: W6.1 `src/opencode/human-gate-record.cjs`
- Goal: record real OpenCode human reply events as `HUMAN_GATE / AUDIT / CONFIRMED` in `gate-decisions.jsonl`.
- Boundary: local OpenCode adaptation only. This does not prove full canonical Claude Code parity or live OpenCode runtime loading.

## Acceptance

- Records `question.replied` and `permission.replied` events through the repo-local OpenCode plugin.
- Requires a real non-empty answer before writing a human gate record.
- Records `CONFIRMED` only as audit evidence that a user response existed, not as approval.
- Redacts common secret formats in answers and tool identifiers before writing logs.
- Writes only to the active run directory and rejects symlink/hardlink target files.
- Fails silently on absent, inactive, or corrupt state because this is telemetry only.
- Registers through the repo-local pipeline adaptation plugin and public OpenCode index.

## RED

Initial command:

```text
node tests/unit/human-gate-record.test.cjs
```

Initial result before implementation:

```text
Error: Cannot find module '../../src/opencode/human-gate-record.cjs'
```

Additional RED during remediation:

```text
Summary: 80 passed / 1 failed / 81 total
```

Failures covered: unsafe symlink target, OpenCode generic event hook not registered, quoted object secret redaction, permission reply event handling, empty answer handling, and wrong runDir precedence.

## GREEN

Focused command:

```text
node tests/unit/human-gate-record.test.cjs
```

Focused result:

```text
human gate record OK
```

Full command:

```text
npm test
```

Full result:

```text
Summary: 81 passed / 0 failed / 81 total
```

## Fixes Applied

- Added repo-local human gate recorder for `permission.replied`, `question.replied`, and generic `event` hooks.
- Added answer extraction for OpenCode event envelopes using `event.type` and `event.properties`.
- Added non-empty answer requirement to avoid false confirmation.
- Added redaction for common secret strings, JSON object secret fields, and event identifiers.
- Limited audit callback payload so it does not expose run paths or full answer records.
- Hardened log target validation against external runDir overrides, sibling runDir writes, symlinks, and hardlinks.

## Adversarial Review

Initial security review: NO-GO.

Main blockers found:

- Event shape did not match OpenCode generic event hook.
- Secret masking was incomplete for object answers and common token formats.
- Symlink/hardlink and wrong runDir cases needed proof.
- Empty answers could be recorded as confirmation.
- Audit callback could imply a write succeeded when it did not.

Final security review: GO for W6.1 code/security scope.

Quality review: code/test coverage was acceptable after evidence registration; earlier NO-GO was due to missing evidence files.

## Final Verdict

GO for W6.1 repo-local OpenCode subset after evidence registration.

## Residual Risk

- Redaction is best effort and may miss unknown secret formats.
- This observer fails silently by design, so missing/corrupt state means no record is written.
- The test imports the repo-local plugin file but does not prove full live OpenCode runtime execution.
