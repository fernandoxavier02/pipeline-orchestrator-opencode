# Pipeline Orchestrator — OpenCode (standalone)

<div align="center">

[![License: PolyForm Shield](https://img.shields.io/badge/License-PolyForm_Shield_1.0.0-blue.svg?style=for-the-badge)](LICENSE)
[![Platform: OpenCode](https://img.shields.io/badge/Platform-OpenCode-green.svg?style=for-the-badge)](https://opencode.ai)
[![FX Studio AI](https://img.shields.io/badge/FX_Studio_AI-Enterprise_Governance-FF6B6B?style=for-the-badge)](https://github.com/fernandoxavier02)

**Independent adaptation of Pipeline Orchestrator for the OpenCode AI ecosystem.**

</div>

---

## 🌟 Overview

**Pipeline Orchestrator for OpenCode** is a standalone multi-agent execution governance system operating between task planning and code delivery. It provides deterministic task classification, structured quality gates, enforced TDD cycles, adversarial review with isolated context, and immutable audit trails across bugfix, feature, audit, UX, and SPEC workflows.

This repository is **completely standalone** from the canonical Claude Code plugin ([`Pipeline-Orchestrator`](https://github.com/fernandoxavier02/Pipeline-Orchestrator)): it features its own repository, standalone Git distribution, and runtime engine.

- **Distribution:** Git standalone
- **Runtime:** Node.js ≥ 18, CommonJS
- **Installable Artifacts:** `.opencode/` (agents, commands, skills, plugins) + `opencode.json`

---

## 🚀 Installation

```bash
# Clone the repository
git clone https://github.com/fernandoxavier02/pipeline-orchestrator-opencode.git
cd pipeline-orchestrator-opencode

# Install globally into OpenCode configuration
node scripts/install.cjs --global --apply

# Dry-run installation for a specific target project (no writes)
node scripts/install.cjs --target /path/to/project

# Apply installation to a specific target project
node scripts/install.cjs --target /path/to/project --apply
```

The installer copies artifacts from `.opencode/` and `opencode.json` to the target project. Global installation targets `~/.config/opencode/`, configuring global commands across all local workspaces.

---

## 💡 How to Use

After global installation, launch any project in OpenCode and use the registered slash commands:

- `/pipeline`: Full governed multi-agent execution pipeline.
- `/bugfix`: Automated bug triage and root-cause remediation.
- `/bugfix-light` & `/bugfix-heavy`: Lightweight or deep bugfix workflows.
- `/feature-light` & `/feature-heavy`: Fast or exhaustive feature development cycles.
- `/audit-light` & `/audit-heavy`: Read-only compliance and security auditing.
- `/ux-light` & `/ux-heavy`: User experience and frontend review.
- `/spec-light` & `/spec-heavy`: Spec generation and contract verification.
- `/verify-completion`: Evidence verification before declaring completion.
- `/Pipeline Orchestrator Help`: Interactive usage guide within OpenCode.

---

## 🧪 Verification & Tests

```bash
node scripts/run-tests.cjs
```

---

## 📁 Repository Structure

```
.
├── src/          # Runtime engine, validators, state machine, verification
├── tests/        # Contract test suite + unit tests
├── specs/        # Canonical parity bugfix specifications
├── scripts/      # run-tests.cjs, install.cjs
├── .opencode/    # Installable artifacts (agents, commands, skills, plugins)
├── opencode.json # OpenCode command definitions
└── plan.md       # Adaptation and parity roadmap
```

---

## 🛡️ Relation to Canonical Pipeline Orchestrator

This project **does not mutate** the canonical Claude Code plugin and **is not bundled** with it. Both lineages evolve independently. Behavioral parity is validated via contract tests (`specs/canonical-parity-bugfix/`).
