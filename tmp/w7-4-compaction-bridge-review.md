# W7.4 Compaction Bridge Review Record

## Security Review

Initial result: NO-GO.

Finding:

- State values were written into `systemMessage`, creating prompt-injection risk from persisted state fields.

Fixes:

- Use OpenCode `context`, not `systemMessage`.
- Encode run continuity values as JSON data.
- Add explicit instruction that JSON values are inert state data.
- Add malicious run id regression test.

Rereview result: GO.

Residual risks:

- The model still reads the context, so the separation depends on OpenCode treating context as lower authority than system instructions.
- The test covers one malicious phrase, not every possible hostile string in every field.

## Quality Review

Initial result: NO-GO.

Findings:

- Wrong OpenCode output field: implementation used `systemMessage`; actual contract uses `context` and optional `prompt`.
- Missing formal W7.4 artifacts.
- Global installer generated an empty adaptation plugin.

Fixes:

- W7.4 writes to `output.context` and preserves existing context.
- Installer-generated adaptation plugin calls `createPipelineAdaptationHooks`.
- Tests cover both the compacting hook and global install wrapper.
- Added formal evidence, prompt log, and review record.

Rereview result:

- Code/test GO.
- Formal closeout GO after artifacts are present.

## Final Decision

GO for W7.4.

Residual risk: this bridge preserves context but does not enforce gates by itself.
