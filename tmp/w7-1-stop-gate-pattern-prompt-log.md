# W7.1 Stop Gate Pattern Prompt Log

## User Approval

The user approved continuing with W7.1 after being told this is an observer-only compensation, not deterministic Claude Code parity.

The user also approved editing the global OpenCode configuration files after the quality review found the global plugin and skill were stale.

## Implementation Prompt Summary

Implement W7.1 for the OpenCode adaptation:

- Add a stop/session idle observer hook.
- Detect active sentinel state for the current project.
- Ignore terminal or inactive runs.
- Record `PIPELINE_STOP_ATTEMPT` in the protocol event log.
- Increment `continuity_attempts` safely.
- Mark the run `hard_failed` after the third continuity attempt.
- Keep behavior observer-only and document that limitation.
- Wire the hook into the repo-local plugin and exports.
- Ensure the repo-local and global OpenCode skill text mention the observer-only stop rule.
- Ensure the global OpenCode plugin loads the repo-local hook implementation.

## Review Prompt Summary

Independent adversarial quality review was asked to inspect the W7.1 files and global activation evidence without trusting the implementer summary. The reviewer returned no code blocker, but required formal evidence artifacts before GO.
