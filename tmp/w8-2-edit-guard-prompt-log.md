# W8.2 Edit Guard Prompt Log

## User Request

Continue the local OpenCode Pipeline Orchestrator adaptation after W8.1.

## Approved Plan

- Implement W8.2 as local OpenCode `edit-guard-hook`.
- Use TDD: RED test first, then GREEN implementation.
- Run full test suite.
- Run adversarial security and quality reviews in loop.
- Record acceptance, RED, GREEN, prompt result, review result, and final verdict.
- Commit and push only after evidence and verification pass.

## Key Decisions

- Reuse `sentinel-state-inspector` for state, active locks, active execution windows, pending blocks, and path exemptions.
- Reuse `detect-shell-write` for shell-write detection.
- Do not copy the canonical Claude Code hook wholesale.
- Pending blocks win before pipeline artifact and execution-window exceptions.
- Required unapproved plan gate blocks edits and shell writes.
- Scope-lock gate stays before edit guard in plugin order so specific scope errors win.

## Commands Run

```text
node tests/unit/edit-guard-hook.test.cjs
npm test
node tests/unit/scope-lock-hook.test.cjs
node tests/unit/edit-guard-hook.test.cjs
npm test
```

## Result

Focused tests and full suite pass after remediation.
