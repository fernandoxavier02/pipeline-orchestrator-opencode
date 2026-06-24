# W9.2 Type-Specific Agents Evidence

## Scope

- Added 21 local OpenCode type-specific pipeline agents under `.opencode/agents/`.
- Updated `tests/unit/opencode-agents.test.cjs` to validate all 30 local agents.
- Kept original Claude Code plugin files read-only.

## Acceptance

- All 21 new type-specific agents exist with local `pipeline-` names.
- All 30 local agents are validated by the agent directory test.
- New agents include Role, Evidence, OpenCode adaptation scope, structured question gate language, acceptance, RED, GREEN, prompt result, review result, final verdict, and Claude Code plugin files read-only language.
- Tests explicitly require structured question gate coverage for safety, scope, TDD, protected original file decisions, and external sending.
- Adversarial agents deny edit and bash permissions.

## RED

Command:

```text
node tests/unit/opencode-agents.test.cjs
```

Expected failure captured before creating the agents:

```text
AGENT_MISSING for 21 type-specific pipeline agents
```

## GREEN

Focused command:

```text
node tests/unit/opencode-agents.test.cjs
```

Result:

```text
opencode agents OK
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

- Added explicit gate contract coverage for safety, scope, TDD, protected original files, and external sending.
- Strengthened tests to assert those gate terms.

Initial quality review: BLOCKED.

- Added authenticity lines to each new agent.
- Raised the useful content floor for type-specific agents.

Final security review: GO.

Final architecture review: GO.

Final quality review: GO.

## Final Verdict

GO for W9.2.
