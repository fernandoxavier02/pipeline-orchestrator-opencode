# W9.4 Mode Skills Evidence

## Acceptance

- Added 10 local OpenCode mode skills under `.opencode/skills`.
- Added step files for all expected mode counts:
  - bugfix-light: 8
  - bugfix-heavy: 11
  - feature-light: 13
  - feature-heavy: 13
  - audit-light: 9
  - audit-heavy: 9
  - ux-sim-light: 5
  - ux-sim-heavy: 7
  - spec-light: 6
  - spec-heavy: 9
- Kept original Claude Code plugin files read-only.
- Preserved local OpenCode subset wording; no full canonical parity claim.

## RED Test

Command: `node tests/unit/opencode-skills.test.cjs`

Expected failure before implementation:

```text
SKILL_MISSING: bugfix-light
SKILL_MISSING: bugfix-heavy
SKILL_MISSING: feature-light
SKILL_MISSING: feature-heavy
SKILL_MISSING: audit-light
SKILL_MISSING: audit-heavy
SKILL_MISSING: ux-sim-light
SKILL_MISSING: ux-sim-heavy
SKILL_MISSING: spec-light
SKILL_MISSING: spec-heavy
```

## GREEN Test

Command: `node tests/unit/opencode-skills.test.cjs`

Result:

```text
opencode skills OK
```

Command: `npm test`

Result:

```text
Summary: 93 passed / 0 failed / 93 total
```

## Prompt Result

- Initial implementation was rejected by adversarial review because step files were too generic, mode skills used Claude-only `AskUserQuestion` wording, untrusted input was not explicit, and start-step references became stale.
- Remediation added exact step counts, OpenCode question-tool wording, untrusted-input protection, and test coverage for existing start-step references.

## Review Result

- Security re-review: GO after untrusted-input and OpenCode gate wording remediation.
- Architecture/quality re-review initially found stale start-step references.
- Final focused adversarial review after start-step remediation: GO.

## Final Verdict

GO. W9.4 is complete for the local OpenCode supported subset. This does not claim full canonical Claude Code controller parity.
