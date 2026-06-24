# W7.3 Session Cleanup Evidence

## Acceptance

- Add an OpenCode-compatible `session.idle` observer for session cleanup.
- Remove transient `.exec-window` files for the current session.
- Remove expired `.lock` files for the current session.
- Mark active session locks completed only when no governed run exists or when the governed run is already terminal.
- Do not mark a lock completed while a governed run is still active.
- Avoid symlink/junction escapes from `.pipeline/sessions`.
- Wire the hook into the repo-local and global OpenCode plugin path.
- Keep behavior observer-only and soft-fail on teardown.

## RED Evidence

Initial RED command:

```text
node tests/unit/session-cleanup-hook.test.cjs
```

Initial failure before implementation:

```text
Error: Cannot find module '../../src/opencode/session-cleanup-hook.cjs'
```

Security/quality follow-up RED command after adding missing edge cases:

```text
node tests/unit/session-cleanup-hook.test.cjs
```

Observed failure before fix:

```text
AssertionError: true !== false
```

This failure proved expired session locks were not yet being removed.

## GREEN Evidence

Focused command:

```text
node tests/unit/session-cleanup-hook.test.cjs
```

Result:

```text
session cleanup hook OK
```

Full suite command:

```text
npm test
```

Result:

```text
Summary: 86 passed / 0 failed / 86 total
```

Global OpenCode plugin load command:

```text
node -e "Promise.resolve(require('C:/Users/win/.config/opencode/plugins/pipeline-adaptation-plugin.js')({}, {})).then((hooks) => { console.log(JSON.stringify(Object.keys(hooks).sort())); }).catch((error) => { console.error(error); process.exit(1); })"
```

Result:

```text
["event","permission.replied","question.replied","session.idle","tool.execute.after","tool.execute.before","tui.prompt.append"]
```

## Review Evidence

Initial security review: NO-GO.

Finding:

- Temporary file write path was predictable and could be precreated as a symlink/junction target.

Fix:

- Temporary file suffix is random by default.
- Temporary file is opened with exclusive create.
- Target lock file is checked for symlink before rename.
- Test covers a malicious preexisting temporary path.

Security rereview: GO.

Initial quality review: NO-GO.

Findings:

- Missing formal W7.3 evidence artifacts.
- The W7.3 plan said expired locks should be cleaned, but tests did not cover expired lock removal.

Fix:

- Added expired lock removal behavior and test coverage.
- Added this evidence file, prompt log, and review record.

Quality rereview: code/test GO; final formal GO after adding artifacts.

## Final Verdict

GO for W7.3 as an OpenCode observer-only subset implementation.

Known limitation: cleanup is best-effort on `session.idle`; it cannot guarantee cleanup if OpenCode or the host process exits before the observer runs.
