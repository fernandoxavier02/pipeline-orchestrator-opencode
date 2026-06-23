---
name: pipeline-orchestrator
description: Use when running the OpenCode Pipeline Orchestrator adaptation end to end with protected scope, gates, tests, prompts, and reviews.
---

# Pipeline Orchestrator

Run the local OpenCode adaptation only. This is a supported subset, not full canonical parity with the Claude Code plugin.

Do not claim it mirrors the canonical controller unless the current run proves the same phases, gates, dispatch protocol, sentinel checkpoints, and closeout evidence.

Keep original Claude Code plugin files read-only.

Use structured question gates for user decisions. Refuse free-form approval when the choice affects safety, scope, TDD, original protection, or external sending.

Reject missing evidence before moving phases. Required evidence includes acceptance, RED test, GREEN test, prompt result, review result, and final verdict.
