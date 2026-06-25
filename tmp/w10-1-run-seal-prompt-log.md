# W10.1 Prompt Log

## Scope

Port the local OpenCode subset of `run-seal` infrastructure.

## Decisions

- Keep canonical Claude Code files read-only.
- Use JSON-backed `manifest.yaml` parsing for the local OpenCode adaptation instead of importing the canonical manifest class.
- Require explicit `allowedRoot` to prevent arbitrary absolute writes.
- Treat schema-validation signer as the local sentinel trust model.
- Fail closed on missing manifest, non-Spec manifest, missing sentinel, missing artifacts, missing review done, or missing convergence.

## Commands

```text
node tests/unit/run-seal.test.cjs
npm test
```

## Outcome

The RED test failed because the module was absent. The final GREEN suite passed with 94 tests and zero failures.
