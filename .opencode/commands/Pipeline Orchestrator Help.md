---
description: Show Pipeline Orchestrator OpenCode usage guide.
agent: pipeline-run-orchestrator
---

Use the pipeline-orchestrator skill and pipeline-contracts skill.

Show a short user guide for the Pipeline Orchestrator OpenCode plugin.

Explain that this is a local OpenCode adaptation, not full canonical parity with the Claude Code plugin.

Teach these commands:
- /pipeline: full governed pipeline.
- /bugfix: bugfix pipeline with automatic routing.
- /bugfix-light and /bugfix-heavy: explicit bugfix variants.
- /feature-light and /feature-heavy: feature delivery variants.
- /audit-light and /audit-heavy: read-only audit variants.
- /ux-light and /ux-heavy: UX review variants.
- /spec-light and /spec-heavy: specification variants.
- /verify-completion: check evidence before claiming done.
- /Pipeline Orchestrator Help: show this guide.

Explain that structured gates are required for safety, scope, TDD, protected original file, external sending, and consent decisions. Explain that required evidence includes acceptance, RED test, GREEN test, prompt result, review result, and final verdict. Do not touch original Claude Code plugin files.
