# W7.1 Stop Gate Pattern Evidence

## Acceptance

- Add an OpenCode-compatible stop/session idle observer for active Pipeline Orchestrator runs.
- Record `PIPELINE_STOP_ATTEMPT` to `protocol-events.jsonl` when a governed run is still active.
- Increment `continuity_attempts` in sentinel state.
- Mark the run `hard_failed` after 3 continuity attempts.
- Do not claim deterministic stop blocking parity with Claude Code; document the observer-only limitation in the local and global skill text.
- Ensure the repo-local OpenCode plugin and the global OpenCode plugin load the hook.

## RED Evidence

Command:

```text
node tests/unit/stop-gate-pattern.test.cjs
```

Observed failure before implementation:

```text
Error: Cannot find module '../../src/opencode/stop-gate-pattern.cjs'
```

## GREEN Evidence

Focused command:

```text
node tests/unit/stop-gate-pattern.test.cjs
```

Result:

```text
stop gate pattern OK
```

Full suite command:

```text
npm test
```

Result:

```text
Summary: 84 passed / 0 failed / 84 total
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

Initial security review found blockers around lock behavior and audit ordering. Fixes applied:

- `maxAttempts: 1` on the lock so the observer does not stall teardown.
- `continuity_attempts` is computed inside the locked state mutation.
- `PIPELINE_STOP_ATTEMPT` is appended only after the state mutation succeeds.

Final security rereview: GO.

Quality rereview after global activation fix: no code blocker found. The only NO-GO was missing formal RED, prompt, review, and verdict artifacts. This file and the companion prompt/review artifacts close that evidence gap.

## Final Verdict

GO for W7.1 as an OpenCode subset implementation.

Known limitation: this is observer-only. It records and accounts for stop/session idle attempts, but does not deterministically block a stop the way the canonical Claude Code Stop hook can.
