# W9.2 Type-Specific Agents Prompt Log

## User Authorization

- User asked to continue and complete remaining local OpenCode Pipeline Orchestrator work.

## Slice Goal

- Port the 21 type-specific agents listed in W9.2 into local OpenCode agent files.
- Keep this as a supported OpenCode subset, not a full canonical parity claim.
- Keep canonical Claude Code plugin files read-only.

## Key Decisions

- Use local `pipeline-` prefixed agent names.
- Preserve OpenCode terminology such as Task and structured question gate.
- Require explicit gates for safety, scope, TDD, protected original files, and external sending.
- Add role-specific authenticity lines instead of generic placeholder prompts.

## Verification Commands

```text
node tests/unit/opencode-agents.test.cjs
npm test
```

## Results

```text
opencode agents OK
Summary: 93 passed / 0 failed / 93 total
```
