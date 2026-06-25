# W9.6 Prompt Log

## Scope

Add the local OpenCode `help` command.

## Decisions

- Keep the command informational, not a workflow that edits files.
- Keep original Claude Code plugin files read-only.
- Include local OpenCode subset wording and avoid claiming full canonical parity.
- Mention structured gates, required evidence, and `verify-completion`.

## Commands

```text
node tests/unit/opencode-commands.test.cjs
npm test
```

## Outcome

The RED test failed on missing `help`. The GREEN command test passed. The final suite passed with 93 tests and zero failures.
