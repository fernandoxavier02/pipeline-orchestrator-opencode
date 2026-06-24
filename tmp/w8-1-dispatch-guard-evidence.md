# W8.1 Dispatch Guard Evidence

## Acceptance

- Add local OpenCode `dispatch-guard` for `tool.execute.before` dispatch checks.
- Block protected pipeline agent dispatch without `PLAN_MODE_RESULTS`.
- Block execution dispatch for medium/complex/spec work without STEP 1.7 routing.
- Keep this as a minimal local OpenCode subset, not a full canonical 1160-line port.
- Wire into plugin composition and public OpenCode exports.

## RED

Command:

```text
node tests/unit/dispatch-guard.test.cjs
```

Result before implementation:

```text
Error: Cannot find module '../../src/opencode/dispatch-guard.cjs'
```

## GREEN

Focused tests:

```text
node tests/unit/dispatch-guard.test.cjs
dispatch guard OK

node tests/unit/global-install.test.cjs
global install OK
```

Full suite:

```text
npm test
Summary: 88 passed / 0 failed / 88 total
```

## Coverage Added

- Plan-Mode bypass blocks without `PLAN_MODE_RESULTS`.
- Valid `PLAN_MODE_RESULTS` allows the dispatch to continue.
- STEP 1.7 missing blocks execution dispatch for scoped work.
- STEP 1.7 present allows execution dispatch.
- Simple work does not trigger STEP 1.7 enforcement.
- Warning-mode environment flag produces warning instead of block.
- Corrupt sentinel blocks dispatch.
- Inactive pipeline does not block.
- Input shape variants are recognized.
- Output mutation of target/prompt is blocked.
- Output injection of target/prompt when input has none is blocked.
- Real OpenCode agent aliases are covered: `pipeline-planner`, `pipeline-pre-tester`, and `pipeline-implementer`.
- Combined warning-mode Plan-Mode plus missing STEP 1.7 still blocks on STEP 1.7.
- Stale marker expires.
- Marker writes outside the project pipeline directory are rejected.
- Installed wrapper smoke verifies `tool.execute.before` hook is exposed.
- Plugin composition conflict test verifies `GATE_LOG_MISSING` wins over the new dispatch guard.
- Temporary real install using this repository's artifacts imports the installed wrapper and proves `pipeline-planner` is blocked by the real dispatch guard.

## Final Verdict

Security GO obtained. Quality requested stronger proof, then composed-gate and real-install tests were added and the full suite passed again.
