# W8.3 Force Pipeline Agents Prompt Log

## User Request

Continue the local OpenCode Pipeline Orchestrator adaptation after W8.2.

## Approved Plan

- Implement W8.3 as local OpenCode `force-pipeline-agents`.
- Use TDD: RED test first, then GREEN implementation.
- Run focused tests and full suite.
- Run adversarial security and quality reviews in loop.
- Record acceptance, RED, GREEN, prompt result, review result, and final verdict.
- Commit and push only after evidence and verification pass.

## Key Decisions

- Keep W8.3 as guidance injection, not a deterministic execution block.
- Use `tui.prompt.append` and `event` fallback, matching local OpenCode plugin style.
- Avoid full canonical parity claims in injected text.
- Preserve prior system messages by appending instead of replacing.
- Keep pipeline-arm writer first in plugin composition so arm markers still write.
- Add Langfuse consent enforcement because review found external-send risk in the composed plugin.

## Commands Run

```text
node tests/unit/force-pipeline-agents.test.cjs
npm test
node tests/unit/force-pipeline-agents.test.cjs
node tests/unit/langfuse-hook.test.cjs
npm test
```

## Result

Focused tests and full suite pass after remediation.
