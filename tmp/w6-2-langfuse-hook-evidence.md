# W6.2 Langfuse Hook Evidence

## Scope

- Slice: W6.2 `src/opencode/langfuse-hook.cjs`.
- Goal: add local OpenCode `tool.execute.before` and `tool.execute.after` hooks for agent telemetry.
- Boundary: local OpenCode adaptation only. Canonical Claude Code files were read-only references. This does not prove full canonical Langfuse parity or live network delivery.

## Acceptance

- Telemetry is disabled unless `LANGFUSE_ENABLED` is `true` or `1`.
- Tests use an injected fake client and perform no real external send.
- Before hook opens a trace/span for agent dispatches and writes a protected carrier.
- After hook closes the span with output and positive duration.
- Span metadata includes run id, phase, type, complexity, and agent name.
- Prompt/output/name fields are sanitized before telemetry or audit payloads.
- Pre-created, forged, tampered, stale, missing, symlink, and hardlink-style carrier risks are treated as no-op rather than trusted telemetry.
- Hook is registered through repo-local plugin composition and public OpenCode index.

## RED

Initial command:

```text
node tests/unit/langfuse-hook.test.cjs
```

Initial result before implementation:

```text
Error: Cannot find module '../../src/opencode/langfuse-hook.cjs'
```

## GREEN

Focused command:

```text
node tests/unit/langfuse-hook.test.cjs
```

Focused result:

```text
langfuse hook OK
```

Full command:

```text
npm test
```

Full result:

```text
Summary: 82 passed / 0 failed / 82 total
```

## Fixes Applied

- Added repo-local Langfuse hook for `tool.execute.before` and `tool.execute.after`.
- Added opt-in gate based on `LANGFUSE_ENABLED` and sample-rate support through `LANGFUSE_SAMPLE_RATE`.
- Added fake-client-compatible trace/span open and close paths without importing or requiring the real Langfuse SDK.
- Added protected carrier files with exclusive creation and full-body tamper detection.
- Added in-memory active carrier tracking so forged or stale carrier files cannot close spans.
- Added fallback lookup by tool call id so span close can still clean up when the active state disappears after open.
- Added redaction for prompt, output, trace name, span name, carrier, and audit payload values.
- Registered hooks in the OpenCode plugin composition and index exports.

## Adversarial Review

Initial security review: NO-GO.

Main blockers found:

- Predictable carrier path could be pre-created or overwritten.
- Forged or stale carrier content could close a wrong span.

Second security review: NO-GO.

Main blockers found:

- Carrier content could be modified after creation.
- Active carrier memory was not always cleaned on suspicious or missing carrier states.
- Trace and span names were not sanitized.
- Audit callback errors could break telemetry flow.

Third security review: NO-GO.

Main blockers found:

- If active state disappeared before close, the original carrier path was not found and memory could stay live.
- Raw run id could leak into carrier or audit payload.

Final security review: GO for W6.2 code/security scope.

Quality review before evidence: NO-GO because W6.2 evidence and prompt log did not exist yet.

## Final Verdict

GO for W6.2 repo-local OpenCode subset after evidence registration.

## Residual Risk

- This slice uses injected or explicit clients only; the real Langfuse client modules are planned for W6.3.
- Redaction is best effort and may miss unknown secret formats.
- This is local OpenCode hook coverage, not proof of full live OpenCode runtime behavior.
