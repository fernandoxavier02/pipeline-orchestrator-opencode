# W7.3 Session Cleanup Prompt Log

## User Approval

The user asked to continue after W7.2. A W7.3 plan was presented and approved before code changes.

## Implementation Prompt Summary

Implement W7.3 for the OpenCode adaptation:

- Add a `session.idle` observer for session cleanup.
- Remove transient exec-window files for the current session.
- Remove expired lock files for the current session.
- Mark active lock files completed only when no governed run exists or the governed run is terminal.
- Leave active governed-run locks untouched to avoid masking incomplete pipeline runs.
- Prevent symlink/junction escapes from the sessions directory.
- Wire the hook into the plugin and public exports.
- Keep all behavior observer-only and soft-fail.

## Review Prompt Summary

Security and quality adversarial reviewers were asked to inspect W7.3 independently, compare it to the W7.3 parity-plan intent, and return GO or NO-GO with blockers only.
