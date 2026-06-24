# W9.1 Agent Expansion Evidence

## Scope

- Expanded the 9 local OpenCode pipeline agents under `.opencode/agents/`.
- Strengthened `tests/unit/opencode-agents.test.cjs` to require detailed prompts.
- Kept original Claude Code plugin files read-only.

## Acceptance

- All 9 local agents have at least 50 meaningful non-empty prompt lines.
- Each agent includes `Role:` and `Evidence:` sections.
- Each agent mentions the local OpenCode adaptation.
- Each agent requires structured question gate usage for sensitive decisions.
- Each agent mentions acceptance, RED, GREEN, prompt result, review result, and final verdict.
- Each agent states that original Claude Code plugin files stay read-only.
- Adversarial reviewers keep edit and bash denied.
- The implementer keeps edit allowed.

## RED

Command:

```text
node tests/unit/opencode-agents.test.cjs
```

Expected failure captured before prompt expansion:

```text
AssertionError [ERR_ASSERTION]: pipeline-run-orchestrator prompt is too short
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

- Security review: GO.
- Architecture review: GO.
- Quality review: initial BLOCKED because the reviewer looked at the wrong folder, then rerun with the exact repo path and returned GO.

## Final Verdict

GO for W9.1.
