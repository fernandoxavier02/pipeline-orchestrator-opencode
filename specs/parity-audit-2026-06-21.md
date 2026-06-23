# Parity Audit — Pipeline Orchestrator OpenCode vs Canônico Claude Code

> **Data:** 2026-06-21
> **Auditado por:** OpenCode (modo auditoria de governança)
> **Canônico:** `@fx-studio-ai/pipeline-orchestrator` v8.9.0 (claude-code/Pipeline-Orchestrator)
> **Porta:** `@fx-studio-ai/pipeline-orchestrator-opencode` v0.2.0 (Pipeline-Orchestrator-OpenCode)
> **Baseline da última porta:** v7.8.0 (commit 7618d0c, 2026-05-25)
> **Janela de defasagem:** ~28 dias, 11 releases (v7.13.0 → v8.9.0)
> **Iron Law:** o canônico não foi modificado. Toda afirmação cita arquivo:linha como evidência.

---

## 1. Veredito

**A porta OpenCode v0.2.0 tem fundação contratual sólida (schemas, sentinel, gate protocol, plan-mode gate) mas está 11 releases atrás do canônico v8.9.0 em enforcement de runtime.** A porta implementa 4 enforcements vivos no plugin guard; o canônico tem 28+ hooks + 35 módulos lib. O motor de mode-quality da porta é um simulador de contratos (harness de teste), não enforcement de runtime. Os 8 agentes e 4 skills são stubs. O ponto de entrada do plugin (`pipeline-adaptation-plugin.js`) está vazio — exporta `{}`.

**Classificação dos gaps:**
- **GAP-IMPLEMENTACAO** (fechável portando): 25+ enforcements do canônico não portados
- **GAP-FERRAMENTA** (limite do harness): Stop block, UserPromptSubmit systemMessage, SubagentStop
- **GAP-BY-DESIGN** (trade-off intencional documentado): HMAC → validação de schema
- **GAP-ESCOPO** (deferível): paperclip, refactor, user-story, brainstorm, spec-authoring seal

**Risco crítico:** sem os hooks de enforcement (sentinel-hook, scope-lock, dispatch-guard, edit-guard, step-ledger-gate, batch-review-gate, checkpoint-verdict-gate, phase-verdict-gate, gate-log-gate, dispatch-pending-gate, pipeline-arm-gate), a porta **não tem teeth de runtime** — um agente cooperativo pode pular gates, escrever fora de escopo, despachar sem handshake, ou parar em run incompleto sem ser bloqueado. O `plugin-guard.cjs` cobre só plan-gate + write-scope + phase-order + dispatch-context.

---

## 2. Metodologia

1. **Mapeamento canônico** — leitura de `.claude-plugin/plugin.json`, `hooks/hooks.json`, `.claude/hooks/` (28 hooks), `lib/` (35 módulos), `agents/` (48 arquivos), `skills/` (30+ skills), `commands/` (15 commands), `opencode-adaptation/ENFORCEMENT-CANONICAL-MAP.md` (720 linhas de auto-análise de portabilidade).
2. **Mapeamento porta OpenCode** — leitura de `package.json`, `AGENTS.md`, `README.md`, `plan.md`, `CHANGELOG.md`, `src/` (51 módulos), `.opencode/` (8 agentes, 4 skills, 2 plugins, 11 commands), `opencode.json`, `specs/canonical-parity-bugfix/`, `tests/` (59 testes). Rodei `npm test` → 59/59 passando.
3. **Mapeamento harness OpenCode** — doc oficial `opencode.ai/docs/plugins` (SDK v1.15.x): eventos disponíveis, capacidades de `tool.execute.before/after`, `permission.asked/replied`, `tui.prompt.append`, `session.idle`, `experimental.session.compacting`, custom tools via `tool()`.
4. **Diff por dimensão** — cruzamento do `parity-matrix.md` existente com código real de ambos os lados + `ENFORCEMENT-CANONICAL-MAP.md`.

---

## 3. Snapshot do canônico (v8.9.0)

| Superfície | Quantidade | Local |
|---|---|---|
| Hooks de runtime | 28 arquivos `.cjs` | `.claude/hooks/` |
| Registro de hooks | 1 `hooks.json` (218 linhas) | `hooks/hooks.json` |
| Módulos lib | 35 (incluindo `lib/contracts/`) | `lib/` |
| Agentes | 48 arquivos `.md` (brainstorm 4, core 10, executor 18, quality 8, type-specific 21) | `agents/` |
| Skills | 30+ skills com step files (bugfix, feature, audit, ux-sim, spec, refactor, user-story, review, validate-*, verify-completion, measure-paperclip-fidelity, pipeline) | `skills/` |
| Commands | 15 (pipeline, bugfix, feature, audit, ux, spec, paperclip-*, setup-paperclip, brainstorm, help) | `commands/` |
| Manifesto | `.claude-plugin/plugin.json` (autoDiscover, version 8.9.0) | `.claude-plugin/` |
| Telemetria | Langfuse (langfuse-hook 813 linhas, langfuse-client 476, langfuse-carrier 245) | `lib/` + `.claude/hooks/` |
| Assinatura de estado | HMAC via `sentinel-state-signer.cjs` (275 linhas) | `lib/` |
| Lock de sessão | `session-lock-hook.cjs` (191) + `session-cleanup-hook.cjs` (116) | `.claude/hooks/` |
| Stop gate | `stop-gate-hook.cjs` (244) — bloqueia Stop em run incompleto | `.claude/hooks/` |
| Step ledger | `step-ledger-gate.cjs` (140) + `step-ledger-stamp.cjs` (204) + `lib/step-ledger.cjs` (121) | `.claude/hooks/` + `lib/` |
| Arm gate | `pipeline-arm-gate.cjs` (291) + `pipeline-arm-writer.cjs` (54) + `lib/pipeline-arm.cjs` (85) | `.claude/hooks/` + `lib/` |
| Dispatch guard | `dispatch-guard.cjs` (1160) — Plan-Mode/Brainstorm bypass + STEP 1.7 routing | `.claude/hooks/` |
| Edit guard (SSOT) | `edit-guard-hook.cjs` (769) — descoberta de estado + write-lock + exec-window + dispatch-pending + Plan-Mode + shell-write | `.claude/hooks/` |
| Scope lock | `scope-lock-hook.cjs` (424) — allowed/forbidden + refactor scope lock | `.claude/hooks/` |

**Enforcements novos desde v7.8.0** (14 hooks + 11 modificados + 17 lib novos + 11 lib modificados): ver `ENFORCEMENT-CANONICAL-MAP.md` para ficha técnica completa de cada um.

---

## 4. Snapshot da porta OpenCode (v0.2.0)

| Superfície | Quantidade | Local | Evidência |
|---|---|---|---|
| Plugin entry point | 1 arquivo **vazio** (exporta `{}`) | `.opencode/plugins/pipeline-adaptation-plugin.js:1-3` | `export default async function pipelineAdaptationPlugin() { return {}; }` |
| Plugin guard ativo | 1 arquivo (115 linhas) | `src/opencode/plugin-guard.cjs` | 4 enforcements: plan-gate, write-scope, phase-order, dispatch-context |
| Plugin guard wrapper | 1 arquivo (14 linhas) | `.opencode/plugins/pipeline-guard.js` | importa `createPipelineGuardHooks` |
| Sentinel + gate protocol | 1 arquivo (413 linhas) | `src/opencode/gate-protocol-sentinel.cjs` | 5 checkpoints, gate decisions, handshake timeout, schema validation |
| Plan-gate state | 1 arquivo (64 linhas) | `src/opencode/plan-gate.cjs` | arm/approve/reject com sticky decisions |
| Mode quality (simulado) | 1 arquivo (605 linhas) | `src/opencode/mode-quality.cjs` | 10 modos + final-validation + parity-closeout; **harness de teste, não runtime** |
| Mode routing | 1 arquivo (18232 bytes) | `src/opencode/mode-routing.cjs` | classificador light/heavy |
| Hook smoke | 1 arquivo (9274 bytes) | `src/opencode/hook-smoke.cjs` | smoke test local |
| UI gate interaction | 1 arquivo (11193 bytes) | `src/opencode/ui-gate-interaction.cjs` | wrapper para `question` tool |
| Shell write detection | 1 arquivo (2710 bytes) | `src/opencode/detect-shell-write.cjs` | denylist de comandos de escrita |
| Validador de contratos | 1 arquivo (17100 bytes) | `src/validators/contract-validator.cjs` | schema validation (sem HMAC) |
| Agentes | 8 stubs (~10 linhas cada) | `.opencode/agents/` | run-orchestrator, planner, implementer, pre-tester, information-gate, validator, adversarial-security/architecture/quality |
| Skills | 4 skills finas | `.opencode/skills/` | pipeline-orchestrator (16 linhas), pipeline-contracts, pipeline-tdd, pipeline-adversarial-review |
| Commands | 11 comandos | `opencode.json` | pipeline, bugfix[-light/-heavy], feature[-light/-heavy], audit[-light/-heavy], ux[-light/-heavy], spec[-light/-heavy] |
| Tests | 59 testes (18 contrato + 41 unitários) | `tests/` | `npm test` → 59/59 passando |
| Install/uninstall | 2 scripts | `scripts/` | `install.cjs` (14089 bytes), `run-tests.cjs` |
| Telemetria | 2 arquivos tiny | `src/pilot/` | `observability-sink.cjs` (1009 bytes), `observability-pilot.cjs` (795 bytes) — **sem Langfuse** |
| Lock de sessão | 1 arquivo básico | `src/state/lock-manager.cjs` (1569 bytes) | lock O_EXCL simples |
| State discovery | **não extraído como SSOT** | — | cada módulo faz sua própria descoberta; não há equivalente a `findActiveSentinelState`/`CORRUPT_SENTINEL` |
| HMAC | **não implementado (by design)** | — | `plan.md:268` documenta: "OpenCode não usa HMAC, por design — o mapa de portabilidade troca writeSignedState/HMAC por saveSentinel/schema" |

---

## 5. Capacidades do harness OpenCode (SDK v1.15.x)

Confirmado em `https://opencode.ai/docs/plugins`:

| Primitiva Claude Code | Equivalente OpenCode | Fidelidade | Notas |
|---|---|---|---|
| `PreToolUse` (deny via `permissionDecision:'deny'`) | `tool.execute.before` (bloqueia via throw) | **Alta** | `plugin-guard.cjs:85` já usa este padrão |
| `PreToolUse` (`updatedInput`) | `tool.execute.before` (modifica `output.args`) | **Alta** | doc: ".env protection" e "inject env" exemplos |
| `PostToolUse` (observer) | `tool.execute.after` | **Alta** | `plugin-guard.cjs:101` já usa |
| `PostToolUse:AskUserQuestion` | `permission.asked`/`permission.replied` | **Alta** | eventos de permissão |
| `UserPromptSubmit` (systemMessage inject) | `tui.prompt.append` | **Média** | append ao prompt buffer, não systemMessage — não é injeção de contexto sistêmico |
| `SessionStart` (prompt inject) | `session.created` | **Baixa** | observer-only, sem injeção |
| `Stop` (`decision:block`) | `session.idle` | **Nenhuma** | observer-only, dispara APÓS sessão idle — **não pode bloquear** |
| `SubagentStop` | (sem equivalente) | **Nenhuma** | GAP-FERRAMENTA |
| `EnterPlanMode`/`ExitPlanMode` | (sem equivalente nativo) | **Nenhuma** | simulado via skill + guard |
| `MEMORY.md` auto | (sem equivalente) | **Nenhuma** | escrita explícita em disco |
| `.claude-plugin/plugin.json` | `opencode.json` + plugin directory | **Média** | formato diferente, sem autoDiscover |
| Custom hooks via matchers | `tool.execute.before` para tools específicas | **Alta** | mas sem catch-all matcher explícito — registrar por tool |
| `experimental.session.compacting` | (não existe no Claude Code) | **Bônus** | OpenCode permite injetar contexto na compactação — útil para retomar runs |

---

## 6. Diff por dimensão

### 6.1 Matriz geral

| # | Dimensão | Canônico v8.9.0 | Porta v0.2.0 | Status | Severidade | Tipo de gap |
|---|---|---|---|---|---|---|
| 1 | Contratos físicos (schemas) | `lib/contracts/gate-decision.cjs`, `workflow-manifest.cjs`, `pipeline-agent-result.cjs` | `src/validators/contract-validator.cjs` (17100 bytes) | **Parcial** | HIGH | GAP-IMPLEMENTACAO — contratos canônicos novos (gate-decision SSOT, workflow-manifest, pipeline-agent-result) não portados |
| 2 | Sentinel state | `sentinel-state-signer.cjs` (HMAC) + `findActiveSentinelState` SSOT em `edit-guard-hook.cjs:495` | `gate-protocol-sentinel.cjs` (schema validation, sem HMAC) | **Parcial** | HIGH | GAP-BY-DESIGN (HMAC→schema) + GAP-IMPLEMENTACAO (sem SSOT de descoberta extraído) |
| 3 | Gate protocol | 28+ hooks de enforcement | `plugin-guard.cjs` com 4 enforcements | **Parcial** | CRITICAL | GAP-IMPLEMENTACAO — 24+ enforcements não portados |
| 4 | Plan-Mode gate | `edit-guard-hook.cjs:691` (shouldBlockWithoutApprovedPlan) + `pipeline-arm-gate.cjs` | `plan-gate.cjs` (arm/approve/reject) + `plugin-guard.cjs:42-50` (block write/shell-write) | **Portado** | — | portado em v0.2.0, paridade com Claude Code v8.2.1 |
| 5 | Step ledger | `step-ledger-gate.cjs` (140) + `step-ledger-stamp.cjs` (204) + `lib/step-ledger.cjs` (121) | **não portado** | **Não portado** | HIGH | GAP-IMPLEMENTACAO — sem enforcement de ordem de steps |
| 6 | Batch review gate | `batch-review-gate.cjs` (128) + `lib/batch-review-guard.cjs` (75) | **não portado** | **Não portado** | HIGH | GAP-IMPLEMENTACAO |
| 7 | Checkpoint verdict gate | `checkpoint-verdict-gate.cjs` (124) + `lib/checkpoint-verdict.cjs` (64) + `lib/consecutive-failure-counter.cjs` (45) | **não portado** | **Não portado** | CRITICAL | GAP-IMPLEMENTACAO — sem STOP_RULE (2 falhas = pare) |
| 8 | Phase verdict gate | `phase-verdict-gate.cjs` (74) + `lib/phase-verdict-guard.cjs` (86) | **não portado** | **Não portado** | HIGH | GAP-IMPLEMENTACAO — sem A5-A9 (SSOT_CONFLICT, INFO_GATE_BLOCKED, PLAN_REJECTED, FINAL_ADVERSARIAL_REWORK, GO_NOGO_BLOCK) |
| 9 | Gate log gate | `gate-log-gate.cjs` (122) + `lib/gate-log-guard.cjs` (107) | **não portado** | **Não portado** | HIGH | GAP-IMPLEMENTACAO — sem validação de gates-required-before |
| 10 | Dispatch pending gate | `dispatch-pending-gate.cjs` (219) | **não portado** | **Não portado** | HIGH | GAP-IMPLEMENTACAO — parent pode trabalhar inline enquanto handshake pendente |
| 11 | Dispatch record hook | `dispatch-record-hook.cjs` (280, com `updatedInput`) | **não portado** | **Não portado** | HIGH | GAP-IMPLEMENTACAO — sem envelope `[PIPELINE run=...]` no prompt do subagente |
| 12 | Pipeline arm gate | `pipeline-arm-gate.cjs` (291) + `pipeline-arm-writer.cjs` (54) + `lib/pipeline-arm.cjs` (85) | **não portado** | **Não portado** | CRITICAL | GAP-IMPLEMENTACAO — sem front-door arm gate |
| 13 | Dispatch guard | `dispatch-guard.cjs` (1160) — Plan-Mode/Brainstorm bypass + STEP 1.7 routing | **não portado** | **Não portado** | HIGH | GAP-IMPLEMENTACAO |
| 14 | Edit guard (SSOT) | `edit-guard-hook.cjs` (769) — state discovery + write-lock + exec-window + dispatch-pending + Plan-Mode + shell-write | `detect-shell-write.cjs` (2710 bytes) + plan-gate no plugin-guard | **Parcial** | CRITICAL | GAP-IMPLEMENTACAO — sem SSOT de descoberta, sem write-lock, sem exec-window |
| 15 | Scope lock | `scope-lock-hook.cjs` (424) — allowed/forbidden + refactor scope lock | `plugin-guard.cjs:52-60` (allowedSurfaces apenas) | **Parcial** | HIGH | GAP-IMPLEMENTACAO — sem refactor scope lock, sem forbidden_files denylist |
| 16 | Sentinel hook | `sentinel-hook.cjs` (541) — checkpoint enforcement | `gate-protocol-sentinel.cjs:260` (applySentinelCheckpoint) | **Parcial** | HIGH | GAP-IMPLEMENTACAO — existe a função mas não está wired a `tool.execute.before` |
| 17 | Spec seal guard | `spec-seal-guard.cjs` (273) + `lib/run-seal.cjs` (563) | **não portado** | **Não portado** | MEDIUM | GAP-ESCOPO — spec-authoring seal é fluxo específico do spec-controller |
| 18 | Parallel dispatch gate | `parallel-dispatch-gate.cjs` (254) | **não portado** | **Não portado** | MEDIUM | GAP-IMPLEMENTACAO — warn-first structural gate |
| 19 | Human gate record | `human-gate-record.cjs` (135) — observer de AskUserQuestion | **não portado** | **Não portado** | MEDIUM | GAP-IMPLEMENTACAO — usar `permission.asked`/`permission.replied` |
| 20 | Langfuse telemetry | `langfuse-hook.cjs` (813) + `lib/langfuse-client.cjs` (476) + `lib/langfuse-carrier.cjs` (245) | `src/pilot/observability-sink.cjs` (1009 bytes) + `observability-pilot.cjs` (795 bytes) | **Mínimo** | MEDIUM | GAP-IMPLEMENTACAO — telemetria estrutural ausente |
| 21 | Session lock | `session-lock-hook.cjs` (191) + `session-cleanup-hook.cjs` (116) | `src/state/lock-manager.cjs` (1569 bytes) | **Parcial** | MEDIUM | GAP-IMPLEMENTACAO — lock básico, sem hook UserPromptSubmit/Stop |
| 22 | Stop gate | `stop-gate-hook.cjs` (244) — `decision:block` em run incompleto | **não portado** | **Não portado** | HIGH | GAP-FERRAMENTA — `session.idle` é observer-only, não pode bloquear |
| 23 | Stop hook (telemetria) | `stop-hook.cjs` (842) — run-log writer + fidelity report | **não portado** | **Não portado** | MEDIUM | GAP-IMPLEMENTACAO — usar `session.idle` como observer |
| 24 | Force pipeline agents | `force-pipeline-agents.cjs` (334) — UserPromptSubmit lembrete | **não portado** | **Não portado** | LOW | GAP-IMPLEMENTACAO — usar `tui.prompt.append` |
| 25 | Skill frontmatter parser | `skill-frontmatter-parser.cjs` (235) — frontmatter contract enforcement | **não portado** | **Não portado** | MEDIUM | GAP-IMPLEMENTACAO — parser é harness-independente |
| 26 | Agent prompts | 48 arquivos detalhados (brainstorm 4, core 10, executor 18, quality 8, type-specific 21) | 8 stubs (~10 linhas cada) | **Mínimo** | HIGH | GAP-IMPLEMENTACAO — prompts stubs não guiam execução real |
| 27 | Skills | 30+ skills com step files detalhados (bugfix-heavy 11 steps, feature-heavy 13, audit-heavy 9+tests, etc.) | 4 skills finas (pipeline-orchestrator 16 linhas) | **Mínimo** | HIGH | GAP-IMPLEMENTACAO — skills não guiam execução passo-a-passo |
| 28 | Commands | 15 commands (pipeline, bugfix, feature, audit, ux, spec, paperclip-*, brainstorm, help) | 11 commands (sem paperclip-*, sem brainstorm, sem help) | **Parcial** | LOW | GAP-ESCOPO — paperclip/brainstorm fora de escopo |
| 29 | Bugfix mode | skill bugfix-light (8 steps) + bugfix-heavy (11 steps) + type-specific (diagnostic, root-cause, regression-tester) | `mode-quality.cjs:294-311` (checks simulados) + command `bugfix[-light/-heavy]` | **Parcial** | HIGH | GAP-IMPLEMENTACAO — checks existem como contrato mas sem runtime enforcement nem step files |
| 30 | Feature mode | skill feature-light (13 steps) + feature-heavy (13 steps) + type-specific (implementer, integration-validator, slice-planner) | `mode-quality.cjs:312-327` (checks simulados) + command `feature[-light/-heavy]` | **Parcial** | HIGH | GAP-IMPLEMENTACAO — idem |
| 31 | Audit mode | skill audit-light (9 steps) + audit-heavy (9 steps + tests) + type-specific (intake, domain-analyzer, compliance-checker, risk-matrix) | `mode-quality.cjs:328-342` (checks simulados) + command `audit[-light/-heavy]` | **Parcial** | HIGH | GAP-IMPLEMENTACAO — idem |
| 32 | UX mode | skill ux-sim-light (5 steps) + ux-sim-heavy (7 steps + tests) + type-specific (simulator, qa-validator, accessibility-auditor) | `mode-quality.cjs:343-356` (checks simulados) + command `ux[-light/-heavy]` | **Parcial** | HIGH | GAP-IMPLEMENTACAO — idem |
| 33 | SPEC mode | skill spec-light (6 steps) + spec-heavy (9 steps) + spec-audit-only (5 steps) + spec-init/requirements/design/tasks/review + type-specific (format-gate, content-reviewer, adversarial-critic, post-impl-validator) | `mode-quality.cjs:357-369` (checks simulados) + command `spec[-light/-heavy]` | **Parcial** | HIGH | GAP-IMPLEMENTACAO — sem spec-authoring flow, sem spec-controller, sem run-seal |
| 34 | Refactor mode | skill refactor-light (8 steps) + refactor-heavy (11 steps + tests) | **não portado** | **Não portado** | LOW | GAP-ESCOPO — deferível |
| 35 | User-story mode | skill user-story-light (10 steps) + user-story-heavy (10 steps + tests) | **não portado** | **Não portado** | LOW | GAP-ESCOPO — deferível |
| 36 | Brainstorm mode | `brainstorm-controller.md` + 4 step files (intake, explore, alternatives, ideation) | **não portado** | **Não portado** | LOW | GAP-ESCOPO — deferível |
| 37 | Review/measure/validate | skills review, measure-paperclip-fidelity, validate-design, validate-gap, verify-completion | **não portado** | **Não portado** | LOW | GAP-ESCOPO — deferível |
| 38 | Final-validator | `core/final-validator.md` + `final-adversarial-orchestrator.md` + `stop-gate-hook.cjs` | `mode-quality.cjs:370-376` (final-validation checks) + `runFinalValidation` | **Parcial** | HIGH | GAP-IMPLEMENTACAO — checks existem mas sem gate de stop |
| 39 | Closeout | `core/finishing-branch.md` + `stop-gate-hook.cjs` + `stop-hook.cjs` | `mode-quality.cjs:377-383` (parity-closeout checks) + `runParityCloseout` | **Parcial** | MEDIUM | GAP-IMPLEMENTACAO — checks existem mas sem hook de stop |
| 40 | Paperclip integration | `commands/paperclip-*.md` (9 commands) + `skills/measure-paperclip-fidelity` + `scripts/setup-paperclip` | **não portado** | **Não portado** | LOW | GAP-ESCOPO — deferível |
| 41 | Install/uninstall | N/A (plugin Claude Code) | `scripts/install.cjs` (14089 bytes) + `src/install/` (dry-run, installer, uninstaller) | **Portado** | — | próprio da porta |
| 42 | Test suite | `scripts/run-tests.cjs` + `scripts/lint-types.cjs` + regression suites | `scripts/run-tests.cjs` → 59/59 passando | **Portado** | — | próprio da porta; suite verde |

### 6.2 Resumo por severidade

| Severidade | Contagem | Tipo predominante |
|---|---|---|
| CRITICAL | 4 | GAP-IMPLEMENTACAO (gate protocol, edit guard SSOT, checkpoint verdict, pipeline arm) |
| HIGH | 18 | GAP-IMPLEMENTACAO (majority) + GAP-FERRAMENTA (stop gate) |
| MEDIUM | 9 | GAP-IMPLEMENTACAO + GAP-ESCOPO |
| LOW | 8 | GAP-ESCOPO (deferível) |
| **Total** | **39 dimensões** | |

---

## 7. Riscos críticos

### R7.1 — Sem enforcement de runtime (CRITICAL)

O `plugin-guard.cjs` cobre 4 enforcements. O canônico tem 28+ hooks. Sem os gates de sentinel, scope-lock, dispatch-guard, edit-guard, step-ledger, batch-review, checkpoint-verdict, phase-verdict, gate-log, dispatch-pending, e pipeline-arm, **a porta não tem teeth de runtime**. Um agente cooperativo pode:
- pular gates (sem gate-log-gate, step-ledger-gate)
- escrever fora de escopo (parcialmente coberto por allowedSurfaces, mas sem forbidden_files, sem exec-window, sem dispatch-pending lock)
- despachar sem handshake (sem dispatch-pending-gate, sem dispatch-record-hook com envelope)
- parar em run incompleto (sem stop-gate, GAP-FERRAMENTA)
- pular Plan-Mode (parcialmente coberto por plan-gate, mas sem arm-gate front-door, sem dispatch-guard bypass detection)

**Mitigação:** portar os 14 hooks novos + 11 modificados na ordem de dependência do `ENFORCEMENT-CANONICAL-MAP.md` (Slice 0 → Slice 9).

### R7.2 — SSOT de descoberta de estado não extraído (CRITICAL)

O canônico tem `findActiveSentinelState` + `CORRUPT_SENTINEL` + `discoverStatePath` em `edit-guard-hook.cjs:495/433/442` como SSOT reusado por 14 hooks. A porta não extraíu isso — cada módulo faz sua própria descoberta. Sem este SSOT, portar os gates A resulta em duplicação ou acoplamento ruim.

**Mitigação:** criar `src/state/sentinel-state-inspector.cjs` como primeiro slice (Slice 0) antes de portar qualquer gate A.

### R7.3 — Agentes e skills são stubs (HIGH)

Os 8 agentes em `.opencode/agents/` têm ~10 linhas cada (role + evidence line). O canônico tem 48 agentes com prompts detalhados, step-by-step instructions, e gate protocol wiring. As 4 skills são finas (a principal tem 16 linhas). O canônico tem 30+ skills com step files detalhados.

**Impacto:** mesmo que os hooks de enforcement sejam portados, os agentes não têm prompt suficiente para executar o workflow corretamente. O `run-orchestrator` não sabe quais gates exigir em qual ordem; o `implementer` não sabe como produzir GREEN evidence; o `pre-tester` não sabe como registrar RED evidence.

**Mitigação:** portar os prompts de agentes canônicos (adaptando nomes de tools: `Agent`→`Task`, `AskUserQuestion`→`question`) + portar as skills com step files.

### R7.4 — Stop gate sem equivalente no harness (HIGH, GAP-FERRAMENTA)

O `stop-gate-hook.cjs` (244 linhas) bloqueia o Stop quando um run está incompleto + armado. O OpenCode `session.idle` é observer-only — dispara APÓS a sessão ficar idle, não pode bloquear. Sem isso, o agente pode simplesmente parar no meio de um run governado.

**Mitigação (pattern alternativo):**
1. regra prompt-native forte no SKILL.md: "NUNCA pare em run governado incompleto — retome a próxima etapa pendente ou aborte explicitamente"
2. auditoria pós-fato via `session.idle` que registra `PIPELINE_STOP_ATTEMPT` em protocol-events.jsonl
3. usar `experimental.session.compacting` para injetar estado do run na compactação (preserva contexto se a sessão for compactada em vez de parada)

### R7.5 — Plugin entry point vazio (HIGH)

`.opencode/plugins/pipeline-adaptation-plugin.js` exporta `{}`. O `pipeline-guard.js` existe separadamente mas precisa ser registrado/carregado. Sem o entry point ativo, nem os 4 enforcements existentes do `plugin-guard.cjs` rodam.

**Mitigação:** o `pipeline-guard.js` já está no diretório `.opencode/plugins/` e deve ser auto-carregado pelo OpenCode (doc: "Files in these directories are automatically loaded at startup"). Verificar se está sendo carregado de fato; se não, registrar em `opencode.json`.

### R7.6 — Mode-quality é simulador, não runtime (MEDIUM)

`mode-quality.cjs` (605 linhas) é um harness de teste que lê `input` objects e produz evidence records. Não está wired ao dispatch real de agentes via `Task`. Os 59 testes validam o contrato, não a execução real.

**Mitigação:** após portar hooks + agentes, integrar mode-quality ao runtime: o `run-orchestrator` chama `runModeQualitySprint` com input real dos agentes.

---

## 8. Recomendações de governança

### R8.1 — Estabelecer baseline de paridade mensurável

Criar métrica de "paridade de enforcement" = (enforcements portados / enforcements canônicos) × 100%. Hoje: 4/28+ ≈ 14%. Meta por onda documentada no `parity-plan-2026-06-21.md`.

### R8.2 — Sincronização de versão

A porta v0.2.0 declara baseline v7.8.0. O canônico está em v8.9.0. Recomendo:
- a porta passe a declarar sua baseline canônica no `CHANGELOG.md` e `package.json`
- a cada release da porta, registrar qual versão canônica foi portada
- criar um script de diff que compara `ENFORCEMENT-CANONICAL-MAP.md` do canônico com a cobertura da porta

### R8.3 — Testes de paridade end-to-end

Os 59 testes atuais são testes de contrato (validam schemas e checks isolados). Recomendo adicionar testes de paridade E2E que:
- rodam um bugfix-light real via `Task` dispatch
- comparam `gate-decisions.jsonl` + `protocol-events.jsonl` + `evidence.jsonl` com o output do Claude Code
- validam que os mesmos gates disparam nas mesmas fases

### R8.4 — Documentar trade-offs explicitamente

O `plan.md` documenta HMAC→schema como trade-off. Recomendo documentar também:
- Stop gate (GAP-FERRAMENTA) — qual a perda real? qual o pattern alternativo?
- UserPromptSubmit systemMessage → `tui.prompt.append` — qual a diferença na prática?
- SubagentStop — sem equivalente, qual o impacto?
- Auto-memory — sem equivalente, como preservar contexto entre sessões?

### R8.5 — Governance checklist para futuros portes

Antes de portar qualquer enforcement do canônico:
1. Confirmar a versão canônica de origem
2. Verificar se há dependências de lib não portadas (pré-requisito)
3. Classificar categoria (A/B/C/D) segundo `ENFORCEMENT-CANONICAL-MAP.md`
4. Escrever teste de contrato antes da implementação (TDD)
5. Validar que o `ENFORCEMENT-CANONICAL-MAP.md` do canônico cobre aquele enforcement
6. Registrar a porta no `CHANGELOG.md` com referência à versão canônica

---

## 9. Limites desta auditoria

- **Não li linha-a-linha** os 6 arquivos grandes do canônico (`dispatch-guard.cjs` 1160, `edit-guard-hook.cjs` 769, `langfuse-hook.cjs` 813, `stop-hook.cjs` 842, `codex-operational-runtime.cjs` 963, `fidelity-reporter.cjs` 600). O `ENFORCEMENT-CANONICAL-MAP.md` já traz fichas técnicas deles.
- **Não rode a porta contra um caso real** (bugfix via `Task` dispatch). Os 59 testes são de contrato, não E2E.
- **Não verifiquei empiricamente** se `pipeline-guard.js` está sendo carregado pelo OpenCode em runtime. A doc diz que plugins em `.opencode/plugins/` são auto-carregados, mas não validei.
- **Não verifiquei** se `tui.prompt.append` suporta injeção de systemMessage ou só append de texto no prompt buffer. A doc mostra append, não inject.
- **Não verifiquei** se `tool.execute.before` pode modificar `output.args` para todas as tools ou só algumas. A doc mostra exemplos com `bash` e `read`.

Estes limites são sinalizados para que a próxima onda de trabalho verifique antes de presumir paridade.

---

## 10. Conclusão

A porta OpenCode v0.2.0 é uma **fundação contratual válida** que precisa de **camada de enforcement de runtime** para atingir paridade operacional com o canônico v8.9.0. O caminho está mapeado: o próprio canônico já produziu o `ENFORCEMENT-CANONICAL-MAP.md` com 720 linhas de análise de portabilidade por categoria (A/B/C/D) e esboços de porta para cada enforcement. O próximo passo é executar o `parity-plan-2026-06-21.md` na ordem de dependência documentada.

**Veredito final:** GAP-IMPLEMENTACAO dominante (25+ enforcements portáveis), 1 GAP-FERRAMENTA crítico (Stop block), GAP-BY-DESIGN documentado (HMAC→schema), GAP-ESCOPO deferível (paperclip/refactor/user-story/brainstorm). A paridade contratual é ~60% (schemas + sentinel + plan-gate + mode checks); a paridade de enforcement é ~14% (4/28+ hooks); a paridade de prompts/skills é ~10% (8/48 agentes stub, 4/30+ skills finas).
