# W8.3 Force Pipeline Agents Review

## First Review

Security verdict: BLOCK.

Findings:

- Composed plugin could send Langfuse telemetry externally when `LANGFUSE_ENABLED` was set, without a separate explicit consent gate.
- W8.3 reminder is guidance only, not a hard block; acceptable if not marketed as deterministic protection.

Quality verdict: BLOCK.

Findings:

- Formal W8.3 evidence files were missing.
- Tests did not yet prove existing system message preservation.
- Tests did not yet prove pipeline arm writer still works in full plugin composition.

## Remediation

- Added consent validation to Langfuse hook using approved consent decision plus explicit gate event id before external send.
- Added test proving Langfuse enabled without consent sends nothing.
- Added W8.3 test for preserving existing `systemMessage`.
- Added W8.3 test proving full plugin still writes pipeline arm marker.

## Verification After Remediation

```text
node tests/unit/force-pipeline-agents.test.cjs
force pipeline agents OK

node tests/unit/langfuse-hook.test.cjs
langfuse hook OK

npm test
Summary: 90 passed / 0 failed / 90 total
```

## Second Review

Security verdict: GO.

Quality verdict: BLOCK because formal W8.3 evidence files were missing.

## Final Review State

- Security: GO.
- Quality: GO after adding W8.3 evidence, prompt log, and review record.

Residual risks:

- W8.3 is a strong reminder, not a deterministic block.
- Prompt text detection is heuristic and may miss ambiguous wording.
- If OpenCode changes prompt event shape, this hook may need adjustment.
