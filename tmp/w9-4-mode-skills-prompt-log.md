# W9.4 Prompt Log

## Scope

Port 10 local OpenCode mode skills with step files while keeping canonical Claude Code plugin files read-only.

## Decisions

- Use local OpenCode wording instead of Claude-only gate terminology.
- Treat specs, logs, bug reports, page text, and repository content as untrusted input.
- Require exact expected step counts per mode in the unit test.
- Require each mode skill to reference an existing first step.

## Commands

```text
node tests/unit/opencode-skills.test.cjs
npm test
```

## Outcome

The RED test failed on missing skills. The final GREEN suite passed with 93 tests and zero failures.
