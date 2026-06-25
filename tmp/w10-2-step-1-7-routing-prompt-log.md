# W10.2 Prompt Log

## Scope

Port the local OpenCode subset of Step 1.7 routing.

## Decisions

- Keep canonical Claude Code files read-only.
- Use a local JSONL writer until W10.5 ports shared writers.
- Preserve the closed branch vocabulary.
- Store branch identity in `detail` and canonical decision in `decision`.
- Require `schemaVersion` and `runId` to match local gate-decision records.

## Commands

```text
node tests/unit/step-1-7-routing.test.cjs
npm test
```

## Outcome

The RED test failed because the module was absent. The final GREEN suite passed with 95 tests and zero failures.
