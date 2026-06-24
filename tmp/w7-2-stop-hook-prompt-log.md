# W7.2 Stop Hook Prompt Log

## User Approval

The user confirmed OpenCode had been restarted after W7.1 global configuration changes.

The user approved continuing to W7.2 and approved the minimal plan before implementation.

## Implementation Prompt Summary

Implement W7.2 for the OpenCode adaptation:

- Add a `session.idle` observer for stop telemetry.
- Discover the current pipeline run using the existing sentinel discovery path.
- Append a run summary line to `.pipeline/run-log.jsonl`.
- Generate a per-run `fidelity-report.json`.
- Avoid duplicate run-log rows when material fields are unchanged.
- Preserve existing richer fidelity reports.
- Wire the hook into the plugin and public exports.
- Keep all behavior observer-only and soft-fail.

## Review Prompt Summary

Security and quality adversarial reviewers were asked to inspect W7.2 independently, compare it to the W7.2 parity-plan intent, and return GO or NO-GO with blockers only.
