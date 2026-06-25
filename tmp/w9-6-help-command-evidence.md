# W9.6 Help Command Evidence

## Acceptance

- Added local OpenCode `help` command file.
- Added matching `help` command entry in `opencode.json`.
- Help text lists available local commands.
- Help text preserves the local OpenCode adaptation boundary and says it is not full canonical parity with the Claude Code plugin.
- Help text requires structured gates and closeout evidence.
- Original Claude Code plugin files remained read-only.

## RED Test

Command: `node tests/unit/opencode-commands.test.cjs`

Expected failure before implementation:

```text
COMMAND_MISSING: help
```

## GREEN Test

Command: `node tests/unit/opencode-commands.test.cjs`

Result:

```text
opencode commands OK
```

Command: `npm test`

Result:

```text
Summary: 93 passed / 0 failed / 93 total
```

## Prompt Result

- Added `.opencode/commands/help.md`.
- Added `help` to `opencode.json`.
- Updated command tests to require the help command in both places.
- Help explains available commands, structured gates, required evidence, and `verify-completion`.

## Review Result

- Security review: GO.
- Quality review: NO-GO only for missing W9.6 evidence artifacts.
- This artifact supplies the missing W9.6 acceptance, RED test, GREEN test, prompt result, review result, and final verdict.

## Final Verdict

GO. W9.6 is complete for the local OpenCode supported subset. This does not claim full canonical Claude Code controller parity.
