# W9.3 Pipeline Skill Evidence

## Scope

- Expanded `.opencode/skills/pipeline-orchestrator/SKILL.md`.
- Strengthened `tests/unit/opencode-skills.test.cjs` to require the expanded skill contract.
- Kept original Claude Code plugin files read-only.

## Acceptance

- Skill has at least 100 meaningful non-empty lines.
- Skill documents Phase 0, Phase 1, Phase 1.5, Phase 2, and Phase 3.
- Skill documents Iron Laws.
- Skill documents structured question gate requirements for safety, scope, TDD, protected original files, external sending, and consent.
- Skill documents the Evidence Contract.
- Skill documents acceptance, RED, GREEN, prompt result, review result, and final verdict evidence.
- Skill documents observer-only stop handling and PIPELINE_STOP_ATTEMPT.
- Skill keeps local OpenCode subset scope and avoids full canonical parity claims.

## RED

Command:

```text
node tests/unit/opencode-skills.test.cjs
```

Expected failure captured before expansion:

```text
AssertionError [ERR_ASSERTION]: pipeline-orchestrator skill is too short
```

## GREEN

Focused command:

```text
node tests/unit/opencode-skills.test.cjs
```

Result:

```text
opencode skills OK
```

Full suite command:

```text
npm test
```

Result:

```text
Summary: 93 passed / 0 failed / 93 total
```

## Review Loop

Initial security review: BLOCKED.

- Strengthened tests to assert specific structured question gates and external consent requirements.

Initial quality review: BLOCKED.

- Added explicit test coverage for `Evidence Contract`.

Architecture review: GO.

Final security review: GO.

Final quality review: GO.

## Final Verdict

GO for W9.3.
