# W8.5 Sentinel Hook Evidence

## Scope

- Added `src/opencode/sentinel-hook.cjs`.
- Wired `createSentinelHooks` into the OpenCode adaptation plugin.
- Exported sentinel hook helpers from the OpenCode index.
- Added `tests/unit/sentinel-hook.test.cjs`.

## Acceptance

- Enforces `expected_next` before pipeline agent dispatch.
- Allows sanctioned parallel fan-out when `expected_next` is an array.
- Blocks missing or empty `expected_next` at sentinel checkpoint.
- Allows bootstrap entry-point agents when no sentinel state exists.
- Blocks non-bootstrap pipeline agents when no sentinel state exists.
- Blocks corrupt sentinel state.
- Blocks stale non-authoritative fallback state for this hook.
- Allows inactive pipeline state.
- Preserves earlier guard-specific errors in plugin composition.
- Proves installed plugin wrapper loads sentinel behavior through `installGlobalArtifacts`.

## RED

Command:

```text
node tests/unit/sentinel-hook.test.cjs
```

Expected failure captured before implementation:

```text
Error: Cannot find module '../../src/opencode/sentinel-hook.cjs'
code: 'MODULE_NOT_FOUND'
```

## GREEN

Focused command:

```text
node tests/unit/sentinel-hook.test.cjs
```

Result:

```text
sentinel hook OK
```

Full suite command:

```text
npm test
```

Result:

```text
Summary: 92 passed / 0 failed / 92 total
```

## Review Loop

Initial security review: BLOCKED.

- Fixed suffix bypass by requiring exact canonical agent match.
- Fixed stale fallback state by treating non-authoritative discovery as corrupt for the sentinel hook.

Initial quality review: BLOCKED.

- Added tests for absent `expected_next`.
- Added installed plugin wrapper smoke test.
- Added explicit test preserving earlier `PLAN_MODE_BYPASS` guard specificity.

Final security review: GO.

Final quality review: code/test coverage accepted, blocked only on missing evidence; this file closes that gap.
