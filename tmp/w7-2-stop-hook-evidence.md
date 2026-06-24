# W7.2 Stop Hook Evidence

## Acceptance

- Add an OpenCode-compatible `session.idle` observer for stop telemetry.
- Append a run summary line to `.pipeline/run-log.jsonl`.
- Create a per-run `fidelity-report.json`.
- Preserve an existing richer fidelity report instead of overwriting it.
- Avoid duplicate run-log lines when material fields are unchanged.
- Wire the hook into the repo-local and global OpenCode plugin path.
- Keep behavior observer-only and soft-fail on teardown.

## RED Evidence

Initial RED command:

```text
node tests/unit/stop-hook.test.cjs
```

Initial failure before implementation:

```text
Error: Cannot find module '../../src/opencode/stop-hook.cjs'
```

Quality-review RED follow-up command after adding missing edge cases:

```text
node tests/unit/stop-hook.test.cjs
```

Observed failure before fix:

```text
Error: ENOENT: no such file or directory, open '<temp-project>/.pipeline/docs/Pre-feature-action/run-stop-hook-complete/fidelity-report.json'
```

## GREEN Evidence

Focused command:

```text
node tests/unit/stop-hook.test.cjs
```

Result:

```text
stop hook OK
```

Full suite command:

```text
npm test
```

Result:

```text
Summary: 85 passed / 0 failed / 85 total
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

Security review: GO.

Quality review initially returned NO-GO for two code issues and missing formal artifacts:

- `fidelity-report.json` was not created when `gate-decisions.jsonl` was absent.
- Existing richer fidelity reports could be overwritten by the simplified W7.2 report.

Fixes applied:

- W7.2 now creates a basic fidelity report with `mandatory_triggered: 0` even without gate decisions.
- W7.2 now preserves any existing fidelity report instead of overwriting it.
- Tests cover both cases.

Quality rereview: no remaining code blocker; only formal evidence artifacts were missing.

## Final Verdict

GO for W7.2 as an OpenCode observer-only subset implementation.

Known limitation: the hook records telemetry on idle/stop observation, but cannot guarantee deterministic stop blocking.
