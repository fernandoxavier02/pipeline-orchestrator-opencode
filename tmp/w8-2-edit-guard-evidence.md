# W8.2 Edit Guard Evidence

## Acceptance

- Add local OpenCode `edit-guard-hook` for `tool.execute.before`.
- Block file writes during active governed runs unless the target is a pipeline artifact or an active execution window exists.
- Block shell write commands with the existing conservative shell write detector.
- Make pending dispatch/gate/plan blocks win over artifact and execution-window exceptions.
- Block active session write-lock without execution window even when sentinel state is inactive.
- Enforce required unapproved plan gate for file writes and shell writes.
- Keep canonical Claude Code files read-only and implement only the local OpenCode subset.

## RED

Command:

```text
node tests/unit/edit-guard-hook.test.cjs
```

Initial result before implementation:

```text
Error: Cannot find module '../../src/opencode/edit-guard-hook.cjs'
```

## GREEN

Focused test after implementation and remediation:

```text
node tests/unit/edit-guard-hook.test.cjs
edit guard OK
```

Regression test after plugin order remediation:

```text
node tests/unit/scope-lock-hook.test.cjs
scope lock hook OK
```

Full suite:

```text
npm test
Summary: 89 passed / 0 failed / 89 total
```

## Coverage Added

- Blocks normal file edit during active run without execution window.
- Allows pipeline artifact edit when no pending block exists.
- Allows non-writing shell command.
- Blocks shell write command.
- Blocks pending dispatch before normal edit.
- Blocks pending dispatch before pipeline artifact edit.
- Blocks corrupt sentinel state.
- Allows inactive state without active session lock.
- Allows normal edit when active execution window is valid.
- Blocks pending gate even when execution window is valid.
- Blocks active session lock without execution window even if state is inactive.
- Blocks pending plan even if state is inactive.
- Blocks required unapproved plan gate for edit and shell write.
- Keeps scope-lock-specific errors ahead of edit guard in plugin composition.
- Verifies plugin hook wiring and index export.

## Final Verdict

Security review returned GO. Quality requested formal evidence; this file, prompt log, and review record close that blocker.
