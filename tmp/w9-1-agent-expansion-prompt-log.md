# W9.1 Agent Expansion Prompt Log

## User Authorization

- User asked to continue the local OpenCode Pipeline Orchestrator adaptation.
- User approved expanding all 9 local agents when the plan said 8 but the repo contained 9.

## Slice Goal

- Expand the local OpenCode pipeline agents from minimal stubs into detailed role prompts.
- Keep this scoped to the supported OpenCode subset.
- Avoid claiming full canonical parity.

## Key Decisions

- Expand all 9 local agents because the current local test already expects 9 agents.
- Keep reviewer agents read-only.
- Require every agent prompt to include the same evidence chain: acceptance, RED, GREEN, prompt result, review result, final verdict.
- Require explicit structured question gate language.
- Keep original Claude Code plugin files read-only.

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
