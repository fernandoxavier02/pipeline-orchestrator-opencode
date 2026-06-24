# W7.4 Compaction Bridge Evidence

## Acceptance

- Add an OpenCode-compatible `experimental.session.compacting` hook.
- Preserve active Pipeline Orchestrator run context during compaction.
- Inject run id, phase, workflow, type, complexity, and pending block summaries into OpenCode `context`.
- Preserve existing compaction context.
- Skip when no governed run exists or when the governed run is terminal.
- Treat sentinel values as inert data, not as instructions.
- Avoid leaking prompt/private content from pending blocks.
- Ensure the global installer no longer generates an empty adaptation plugin.

## RED Evidence

Initial RED command:

```text
node tests/unit/compaction-bridge.test.cjs
```

Initial failure before implementation:

```text
Error: Cannot find module '../../src/opencode/compaction-bridge.cjs'
```

Quality/security follow-up RED command after changing the test to OpenCode's real compacting contract:

```text
node tests/unit/compaction-bridge.test.cjs
```

Observed failure before fix:

```text
AssertionError: The "string" argument must be of type string. Received type undefined
```

Installer RED command:

```text
node tests/unit/global-install.test.cjs
```

Observed failure before fix:

```text
AssertionError: expected installed pipeline-adaptation-plugin.js to not contain return {};
```

## GREEN Evidence

Focused commands:

```text
node tests/unit/compaction-bridge.test.cjs
node tests/unit/global-install.test.cjs
```

Results:

```text
compaction bridge OK
global install OK
```

Full suite command:

```text
npm test
```

Result:

```text
Summary: 87 passed / 0 failed / 87 total
```

Global OpenCode plugin load command:

```text
node -e "Promise.resolve(require('C:/Users/win/.config/opencode/plugins/pipeline-adaptation-plugin.js')({}, {})).then((hooks) => { console.log(JSON.stringify(Object.keys(hooks).sort())); }).catch((error) => { console.error(error); process.exit(1); })"
```

Result:

```text
["event","experimental.session.compacting","permission.replied","question.replied","session.idle","tool.execute.after","tool.execute.before","tui.prompt.append"]
```

## Review Evidence

Initial security review: NO-GO.

Finding:

- State values were injected into `systemMessage`, which could make untrusted state text act like high-priority instructions.

Fix:

- W7.4 now writes to OpenCode `context`.
- Continuity payload is encoded as JSON data.
- The context explicitly says JSON values are inert state data, not instructions.
- Test covers a malicious run id phrase.

Security rereview: GO.

Initial quality review: NO-GO.

Findings:

- The hook wrote `systemMessage`, but OpenCode's compacting contract uses `context` and optional `prompt`.
- Formal W7.4 artifacts were missing.
- The global installer generated an empty adaptation plugin.

Fixes:

- Hook writes to `output.context` and preserves existing context.
- Global installer now generates a wrapper that calls `createPipelineAdaptationHooks`.
- Tests cover the compaction contract and global installer wrapper.
- Added this evidence file, prompt log, and review record.

Quality rereview: code/test GO; final formal GO after adding artifacts.

## Final Verdict

GO for W7.4 as an OpenCode-specific compaction bridge.

Known limitation: `experimental.session.compacting` is an OpenCode-specific event and remains context-preservation support, not a deterministic enforcement gate.
