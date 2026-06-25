# W10.1 Run Seal Evidence

## Acceptance

- Added local OpenCode `src/lib/run-seal.cjs`.
- Exported `sealSpecRun` and `REQUIRED_IMPL_GATES`.
- Enforced four pre-seal preconditions:
  - review done through `spec_review_done`.
  - required core spec artifacts exist and `spec.json` parses.
  - `research.md` exists.
  - sentinel state is valid and `spec_review_converged` is true.
- Added `allowedRoot` containment to avoid writing outside the allowed run area.
- Wrote `SPEC_SEALED` idempotently.
- Updated manifest and sentinel as sealed local OpenCode state.
- Kept original Claude Code plugin files read-only.

## RED Test

Command: `node tests/unit/run-seal.test.cjs`

Expected failure before implementation:

```text
Cannot find module '../../src/lib/run-seal.cjs'
```

Additional RED during remediation:

```text
Initial implementation allowed unsafe paths or incomplete precondition paths during adversarial review.
```

## GREEN Test

Command: `node tests/unit/run-seal.test.cjs`

Result:

```text
run seal OK
```

Command: `npm test`

Result:

```text
Summary: 94 passed / 0 failed / 94 total
```

## Prompt Result

- Implemented local JSON-backed run sealing for the OpenCode subset.
- Added tests for relative path rejection, allowed root containment, missing manifest, non-Spec manifest, missing options, missing review done, missing research, invalid spec JSON, missing sentinel, unconverged sentinel, sentinel review false, already-sealed bypass, happy path, JSONL idempotency, and second-seal stability.
- Hardened after review to check real paths for target files and validate the final sentinel state with final checkpoints.

## Review Result

- Initial security/architecture/quality review: NO-GO for unsafe absolute path handling, optional manifest/sentinel paths, incomplete precondition tests, and missing evidence.
- Follow-up security/architecture review: NO-GO for already-sealed bypass and missing evidence.
- Final security review after containment/final-sentinel remediation: GO.

## Final Verdict

GO. W10.1 is complete for the local OpenCode supported subset. This does not claim full canonical Claude Code controller parity.
