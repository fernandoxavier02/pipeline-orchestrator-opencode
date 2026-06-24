# W8.3 Force Pipeline Agents Evidence

## Acceptance

- Add local OpenCode `force-pipeline-agents` hook for `tui.prompt.append`.
- Inject guidance for pipeline-worthy implementation/review/investigation prompts.
- Inject pipeline phase reminder for pipeline entry commands.
- Do not claim full canonical Claude Code parity.
- Preserve existing system message content.
- Keep pipeline arm writer behavior working in the full plugin composition.
- Require explicit consent gate before Langfuse external send, because W8.3 review found that risk in the composed plugin.

## RED

Command:

```text
node tests/unit/force-pipeline-agents.test.cjs
```

Initial result before implementation:

```text
Error: Cannot find module '../../src/opencode/force-pipeline-agents.cjs'
```

## GREEN

Focused tests after implementation and remediation:

```text
node tests/unit/force-pipeline-agents.test.cjs
force pipeline agents OK

node tests/unit/langfuse-hook.test.cjs
langfuse hook OK
```

Full suite:

```text
npm test
Summary: 90 passed / 0 failed / 90 total
```

## Coverage Added

- Trivial chat does not inject guidance.
- Pipeline command injects mandatory phase reminder.
- Implementation prompt injects agent-pipeline reminder.
- Generic non-trivial prompt gets a softer suggestion.
- Event-bus fallback handles `tui.prompt.append` events.
- Hook factory exposes `tui.prompt.append`.
- Full plugin composition exposes the reminder.
- Existing `systemMessage` is preserved.
- Full plugin still writes the pipeline arm marker for local entry commands.
- OpenCode index exports the new hook factory.
- Langfuse enabled without explicit consent sends nothing.

## Final Verdict

Security review returned GO after Langfuse consent remediation. Quality requested formal W8.3 evidence; this file, prompt log, and review record close that blocker.
