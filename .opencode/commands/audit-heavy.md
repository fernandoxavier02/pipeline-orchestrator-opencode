---
description: Run the heavier Pipeline Orchestrator audit flow.
agent: pipeline-run-orchestrator
---

Use the pipeline-orchestrator skill, pipeline-contracts skill, and pipeline-adversarial-review skill.

Run the heavy audit pipeline for: $ARGUMENTS

Keep the workflow read-only. Require approved scope evidence, read-only proof, risk matrix evidence across at least three fronts, source artifacts, adversarial report review, and closeout evidence.

Execute this OpenCode subset as a 9-step audit skeleton. Do not claim full canonical parity unless every step below has evidence.

Step 1: Intake, scope, inventory, and scope approval gate.
Step 2: Architecture, module boundaries, and dependencies.
Step 3: Domain rules, source of truth, and decisions.
Step 4: Contracts, APIs, endpoints, and validations.
Step 5: Data, migrations, integrity, and security.
Step 6: Frontend, state, accessibility, and client behavior.
Step 7: Backend, services, errors, auth, and observability.
Step 8: Governance, tests, release process, and documentation.
Step 9: Pa de Cal, risk matrix, priority backlog, and GO/CONDITIONAL/NO-GO gate.

Required checkpoints: before Step 1, before Step 5, and before Step 9. Any missing evidence keeps the verdict at NO-GO or CONDITIONAL.
