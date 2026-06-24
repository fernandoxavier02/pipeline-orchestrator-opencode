# W6.3 Langfuse Lib Ports Evidence

## Scope

- Slice: W6.3 `src/lib/langfuse-client.cjs`, `src/lib/langfuse-carrier.cjs`, and `src/lib/langfuse-sanitizer.cjs`.
- Goal: add local OpenCode Langfuse support modules and wire the OpenCode hook to the local client by default.
- Boundary: local OpenCode adaptation only. Canonical Claude Code files were read-only references. This is a safe local port of public contracts, not a byte-identical canonical mirror.

## Acceptance

- Public exports are present for client, carrier, and sanitizer modules.
- Langfuse remains opt-in through `LANGFUSE_ENABLED`.
- Disabled mode does not require or instantiate the real Langfuse SDK.
- The real client path is wired by default when enabled and credentials exist.
- Tests use a fake SDK loader and perform no real external send.
- Package dependency for Langfuse is declared.
- Carrier trace write refuses pre-created files and uses exclusive creation.
- Sanitizer redacts known token formats, paths, and sensitive values already present in environment variables.
- Hook prompt/output/agent-name telemetry is sanitized before sending.

## RED

Initial command:

```text
node tests/unit/langfuse-lib-ports.test.cjs
```

Initial result before implementation:

```text
Error: Cannot find module '../../src/lib/langfuse-sanitizer.cjs'
```

## GREEN

Focused commands:

```text
node tests/unit/langfuse-hook.test.cjs
node tests/unit/langfuse-lib-ports.test.cjs
```

Focused results:

```text
langfuse hook OK
langfuse lib ports OK
```

Full command:

```text
npm test
```

Full result:

```text
Summary: 83 passed / 0 failed / 83 total
```

## Fixes Applied

- Added local Langfuse sanitizer with text/object sanitization, path redaction, token redaction, and environment-secret redaction.
- Added local Langfuse carrier with span/trace paths, trace read/write/cleanup, session/doc/ppid fallback keys, and exclusive trace creation.
- Added local Langfuse client with opt-in enablement, sample-rate parsing, lazy SDK require, error logging, and test reset helper.
- Wired the OpenCode Langfuse hook to the local client by default when no injected client is provided.
- Declared the Langfuse package dependency.
- Added tests for exports, disabled mode, fake SDK real path, env-secret redaction, and pre-created carrier refusal.

## Adversarial Review

Initial quality review: NO-GO.

Main blockers found:

- Hook did not use the local client by default.
- Langfuse dependency was not declared.
- Tests did not prove the real enabled path with a fake SDK.

Initial security review: NO-GO.

Main blockers found:

- Hook could leak process environment secret values in telemetry text.
- Carrier trace write could overwrite a pre-created predictable file.

Final security review: GO for W6.3 code/security scope.

Quality review before evidence: NO-GO because W6.3 evidence and prompt log did not exist yet.

## Final Verdict

GO for W6.3 repo-local OpenCode subset after evidence registration.

## Residual Risk

- This is not byte-identical with the canonical Claude Code modules.
- Real Langfuse network delivery still depends on runtime credentials and installed dependency behavior.
- Redaction is best effort and may miss unknown secret formats.
