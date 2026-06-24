# W8.4 Session Lock Evidence

## Acceptance

- Add local OpenCode `session-lock-hook` for `tui.prompt.append` and event fallback.
- Create active session lock when a pipeline entry prompt is submitted.
- Refresh heartbeat for current session on later prompts.
- Mark stale foreign locks completed.
- Reject invalid session ids.
- Reject path escape through `.pipeline` or `sessions` symlinks.
- Preserve prompt submission fail-open behavior.
- Keep plugin ordering verifiable through installer config order.

## RED

Command:

```text
node tests/unit/session-lock-hook.test.cjs
```

Initial result before implementation:

```text
Error: Cannot find module '../../src/opencode/session-lock-hook.cjs'
```

## GREEN

Focused tests:

```text
node tests/unit/session-lock-hook.test.cjs
session lock hook OK

node tests/unit/force-pipeline-agents.test.cjs
force pipeline agents OK

node tests/unit/global-install.test.cjs
global install OK
```

Full suite:

```text
npm test
Summary: 91 passed / 0 failed / 91 total
```

## Review Result

- First security review: BLOCK due to possible path escape through unsafe session directory handling.
- First quality review: BLOCK due to missing W8.4 evidence and missing installer plugin-order coverage.
- Security re-review after containment fix: GO.

## Final Verdict

Ready for final quality re-review after evidence and installer-order test.
