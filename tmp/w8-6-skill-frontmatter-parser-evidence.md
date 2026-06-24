# W8.6 Skill Frontmatter Parser Evidence

## Scope

- Added `src/opencode/skill-frontmatter-parser.cjs`.
- Exported parser and hook helpers from `src/opencode/index.cjs`.
- Wired `createSkillFrontmatterParserHooks` into the OpenCode adaptation plugin.
- Added `tests/unit/skill-frontmatter-parser.test.cjs`.

## Acceptance

- Parses the SKILL.md frontmatter subset used by the pipeline.
- Reads skill frontmatter from the project skills folder.
- Prefers the OpenCode skills folder and keeps legacy skills as fallback.
- Rejects invalid skill names and symlink escapes.
- Filters prototype pollution keys.
- Blocks malformed `sentinel_checkpoints` frontmatter.
- Fails closed when an in-flight skill cannot be read.
- Enforces current skill and variant-based skill checkpoints.
- Logs enforcement decisions only inside the project pipeline folder.
- Rejects symlinked log files that point outside the project pipeline folder.
- Exposes and wires a `tool.execute.before` hook for skill enforcement.

## RED

Command:

```text
node tests/unit/skill-frontmatter-parser.test.cjs
```

Expected failure captured before implementation:

```text
Error: Cannot find module '../../src/opencode/skill-frontmatter-parser.cjs'
code: 'MODULE_NOT_FOUND'
```

## GREEN

Focused command:

```text
node tests/unit/skill-frontmatter-parser.test.cjs
```

Result:

```text
skill frontmatter parser OK
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

Security review blockers resolved:

- Added realpath containment for skill reads.
- Added realpath containment for the skills root and pipeline log root.
- Added log path containment and symlinked log file rejection.
- Filtered dangerous frontmatter keys.
- Guarded enforcement override with an explicit opt-in variable.
- Made unreadable or malformed in-flight skill frontmatter fail closed.

Quality review blockers resolved:

- Added enforcement function and hook wiring.
- Added tests for variant enforcement block/pass.
- Added tests for missing skill read failure.
- Added tests for `tool.execute.before` and plugin composition.

Final security review: GO.
