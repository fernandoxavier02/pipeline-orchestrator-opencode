# W8.5 Sentinel Hook Prompt Log

## User Authorization

- User previously approved continuous execution for W8.4, W8.5, and W8.6 with commit/push per slice.

## Slice Goal

- Port the OpenCode subset of the canonical sentinel hook.
- Enforce checkpoint sequencing through `expected_next` for pipeline agent dispatch.
- Support array `expected_next` for sanctioned parallel fan-out.
- Preserve OpenCode limitations and avoid claiming full Claude Code parity.

## Key Implementation Decisions

- Use exact canonical agent leaf matching only; no suffix matching in the OpenCode hook.
- Treat non-authoritative fallback state as corrupt for this hook, so a broken `active-run.json` cannot silently select stale state.
- Keep the sentinel hook after earlier guards and observability hooks in composition so more specific guard errors and telemetry remain intact.
- Keep bootstrap agents allowed without sentinel state so the pipeline can start.

## Verification Commands

```text
node tests/unit/sentinel-hook.test.cjs
npm test
```

## Results

```text
sentinel hook OK
Summary: 92 passed / 0 failed / 92 total
```
