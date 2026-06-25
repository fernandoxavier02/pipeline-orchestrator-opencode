# W10.2 Step 1.7 Routing Evidence

## Acceptance

- Added local OpenCode `src/lib/step-1-7-routing.cjs`.
- Exported `appendStep17Routing`, `branchToCanonical`, `buildStep17StateBlock`, `BRANCH_VALUES`, and `BRANCH_TO_CANONICAL`.
- Enforced closed branch vocabulary:
  - `load-existing`
  - `dispatch-brainstorm`
  - `no-prep-override`
  - `simples-bypass`
- Mapped branch identity to the local gate-decision vocabulary without adding new decision values.
- Added local gate record fields `schemaVersion` and `runId`.
- Sanitized unsafe IDs and JSONL detail fields.
- Kept original Claude Code plugin files read-only.

## RED Test

Command: `node tests/unit/step-1-7-routing.test.cjs`

Expected failure before implementation:

```text
Cannot find module '../../src/lib/step-1-7-routing.cjs'
```

Additional review-driven RED:

```text
Quality review blocked the first version because the gate record lacked schemaVersion and runId.
```

## GREEN Test

Command: `node tests/unit/step-1-7-routing.test.cjs`

Result:

```text
step 1.7 routing OK
```

Command: `npm test`

Result:

```text
Summary: 95 passed / 0 failed / 95 total
```

## Prompt Result

- Implemented local Step 1.7 routing with a closed branch list and canonical decision mapping.
- Added a safe JSONL append using the existing local lock helper.
- Added test coverage for branch mapping, unsafe branch rejection, unsafe ID coercion, newline sanitization, state block creation, and local gate contract fields.

## Review Result

- Initial security review: GO.
- Initial quality review: NO-GO for missing gate contract fields and missing evidence artifacts.
- Re-review after adding `schemaVersion` and `runId`: GO.
- Security rerun after contract fix: GO.

## Final Verdict

GO. W10.2 is complete for the local OpenCode supported subset. This does not claim full canonical Claude Code controller parity.
