# W8.6 Skill Frontmatter Parser Prompt Log

## User Authorization

- User previously approved continuous execution through W8.6 with commit/push per slice.

## Slice Goal

- Port the OpenCode subset of the canonical `skill-frontmatter-parser` module.
- Add safe SKILL.md frontmatter parsing and checkpoint enforcement helpers.
- Wire the parser hook into the OpenCode plugin without claiming full Claude Code parity.

## Key Decisions

- Use a small YAML subset parser because the canonic module uses the same no-dependency approach.
- Fail closed for unreadable or malformed in-flight skill frontmatter.
- Reject symlink escapes for skill reads and enforcement logs.
- Require an explicit override guard before `PIPELINE_ENFORCEMENT` can downgrade deny to warn.

## Verification Commands

```text
node tests/unit/skill-frontmatter-parser.test.cjs
npm test
```

## Results

```text
skill frontmatter parser OK
Summary: 93 passed / 0 failed / 93 total
```
