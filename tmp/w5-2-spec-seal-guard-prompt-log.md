# W5.2 Spec Seal Guard Prompt Log

## Prompt

Implement W5.2 for the repo-local OpenCode adaptation: add a `spec-seal-guard` hook that blocks `run-seal.cjs` when `spec_review_done !== true`, with TDD, adversarial review, evidence, documentation, commit, and push.

## Result

- RED confirmed missing implementation and later parser bypasses.
- GREEN confirmed focused W5.2 tests and full suite.
- Security adversarial review reached GO after multiple remediation rounds.
- Quality adversarial review reached GO for repo-local code, tests, plugin registration, and exports.
- Global OpenCode install refresh remains outside this slice and is documented as operational residual risk.

## Verification

```text
node tests/unit/spec-seal-guard.test.cjs
spec seal guard OK

npm test
Summary: 79 passed / 0 failed / 79 total
```
