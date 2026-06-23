# Plano de Paridade — Pipeline Orchestrator OpenCode

> **Data:** 2026-06-21
> **Derivado de:** `specs/parity-audit-2026-06-21.md`
> **Canônico alvo:** v8.9.0
> **Porta atual:** v0.2.0 (baseline v7.8.0)
> **Iron Law:** nunca modificar o canônico; paridade validada por testes de contrato, não por cópia de código.

---

## 1. Princípios

1. **Evidência acima de suposição** — cada slice porta um enforcement verificado contra o `ENFORCEMENT-CANONICAL-MAP.md` do canônico e o código real.
2. **TDD obrigatório** — teste de contrato RED antes da implementação GREEN. A suíte `npm test` deve permanecer verde antes de declarar qualquer slice pronto.
3. **Diff mínimo** — portar o enforcement, não reescrever. Preservar nomes canônicos de gates, eventos e schemas.
4. **Ordem de dependência** — respeitar a ordem do `ENFORCEMENT-CANONICAL-MAP.md:700-711` (Slice 0 → Slice 9). Não portar gate A antes do SSOT de descoberta.
5. **Categoria D primeiro** — módulos lib harness-independentes (categoria D) são porta direta CommonJS. Portá-los antes dos hooks que dependem deles.
6. **Declarar baseline canônica** — cada release da porta registra qual versão canônica foi portada no `CHANGELOG.md`.
7. **Não inventar** — se o `ENFORCEMENT-CANONICAL-MAP.md` não cobre um enforcement, parar e perguntar antes de presumir.
8. **Limites do harness documentados** — GAP-FERRAMENTA (Stop block, UserPromptSubmit systemMessage, SubagentStop) tem pattern alternativo documentado, não é ignorado.

---

## 2. Visão geral das ondas

| Onda | Foco | Severidade alvo | Esforço estimado | Dependência |
|---|---|---|---|---|
| **W0** | SSOT de descoberta de estado + lib D sem deps | CRITICAL (pré-requisito) | Médio | nenhuma |
| **W1** | Pipeline arm flow (arm-gate + arm-writer + lib) | CRITICAL | Médio | W0 |
| **W2** | Step ledger (gate + stamp + lib) | HIGH | Médio | W0 |
| **W3** | Verdict gates (batch-review, checkpoint-verdict, phase-verdict, gate-log) | CRITICAL + HIGH | Alto | W0, W2 |
| **W4** | Dispatch enforcement (pending-gate + record-hook com updatedInput) | HIGH | Alto | W0, W1 |
| **W5** | Specialized gates (scope-lock mod, spec-seal-guard, parallel-dispatch) | HIGH + MEDIUM | Médio | W0 |
| **W6** | Telemetry (human-gate-record + langfuse-hook) | MEDIUM | Médio | W0 |
| **W7** | Stop-layer (stop-gate pattern alternativo + stop-hook + session-cleanup) | HIGH (GAP-FERRAMENTA) | Médio | W0 |
| **W8** | Hooks modificados (dispatch-guard, edit-guard wrapper, force-pipeline-agents, session-lock, sentinel, skill-frontmatter-parser) | HIGH | Alto | W0-W7 |
| **W9** | Agentes + skills + commands (prompts canônicos adaptados) | HIGH | Alto | W0-W8 (runtime pronto) |
| **W10** | Infra (hooks.json → plugin manifest, lib/index, run-seal, fidelity-reporter, run-log, run-manifest, gate-decision-writer, jsonl-sanitizer, langfuse-*) | MEDIUM | Médio | W0-W9 |
| **W11** | E2E parity tests (bugfix-light real via Task, comparação com Claude Code) | — | Médio | W0-W10 |
| **DEFER** | Paperclip, refactor, user-story, brainstorm, review/measure/validate | LOW | — | fora de escopo desta porta |

---

## 3. Detalhe por onda

### W0 — SSOT de descoberta de estado + lib D sem deps

**Goal:** estabelecer o alicerce que todos os gates A reusar. Sem este slice, portar gates resulta em duplicação ou acoplamento ruim.

**Pré-requisito do canônico:** `ENFORCEMENT-CANONICAL-MAP.md:665-676` — extrair `findActiveSentinelState`, `discoverStatePath`, `findLivePendingBlock`, `isExemptPath`, `isPlanFile`, `getActiveLock`, `getActiveExecWindow`, `CORRUPT_SENTINEL`, `resolveHandshakeTimeoutMs` de `edit-guard-hook.cjs` para um lib comum.

**Slices:**

| # | Slice | Origem canônica | Alvo porta | Aceitação |
|---|---|---|---|---|
| W0.1 | `src/state/sentinel-state-inspector.cjs` | `edit-guard-hook.cjs:495/433/442/517/569/549` | novo módulo D | exports `findActiveSentinelState`, `discoverStatePath`, `findLivePendingBlock`, `isExemptPath`, `CORRUPT_SENTINEL`; teste unitário passa |
| W0.2 | `src/lib/contracts/gate-decision.cjs` | `lib/contracts/gate-decision.cjs` (116) | porta direta D | exports `SCHEMA_VERSION`, `CANONICAL_DECISIONS`, `CANONICAL_HARDNESS`, `isCanonicalDecision`, `isCanonicalHardness`; teste passa |
| W0.3 | `src/lib/contracts/workflow-manifest.cjs` | `lib/contracts/workflow-manifest.cjs` (220) | porta direta D | exports `WORKFLOWS`, `TERMINAL_STATES`, `DENY_EXCEPTIONS`, `nextAllowedAgents`, `isTransitionAllowed`, `isTerminal`; teste passa |
| W0.4 | `src/lib/contracts/pipeline-agent-result.cjs` | `lib/contracts/pipeline-agent-result.cjs` (185) | porta direta D | exports `parseResultBlock`, `VALID_STATUS`, `KNOWN_KEYS`; teste passa |
| W0.5 | Guards PURE (9 módulos) | `lib/batch-review-guard.cjs`, `checkpoint-verdict.cjs`, `consecutive-failure-counter.cjs`, `domain-scanner.cjs`, `fix-loop.cjs`, `gate-log-guard.cjs`, `phase-verdict-guard.cjs`, `step-ledger.cjs`, `pipeline-workflow-classifier.cjs` | porta direta D | cada um exporta suas funções; testes unitários passam |
| W0.6 | Utils D | `lib/exclusive-lock.cjs` (127), `lib/entry-points.cjs` (112) | porta direta D | exports confirmados; testes passam |
| W0.7 | `src/lib/sentinel-state-signer.cjs` (adaptado) | `lib/sentinel-state-signer.cjs` (275) | porta adaptada D | adaptar para schema validation (sem HMAC, by design); exports `readVerifiedState`, `verifyState` retornam `{valid, unsigned, key_unavailable}` para compat |

**Esforço:** médio (7 slices, todos categoria D — porta direta CommonJS).
**Risco:** baixo. São módulos sem I/O complexo (maioria PURE).
**Verificação:** `npm test` permanece verde; novos testes unitários para cada módulo.

---

### W1 — Pipeline arm flow

**Goal:** estabelecer o arm flow (front-door gate que obriga o usuário a armar o pipeline antes de trabalhar).

**Slices:**

| # | Slice | Origem canônica | Alvo porta | Categoria | Aceitação |
|---|---|---|---|---|---|
| W1.1 | `src/lib/pipeline-arm.cjs` | `lib/pipeline-arm.cjs` (85) | porta direta D | D | exports `writeArmPending`, `clearArmPending`, `markerPath`; marker assinado (adaptar para schema); teste passa |
| W1.2 | `src/opencode/pipeline-arm-gate.cjs` | `.claude/hooks/pipeline-arm-gate.cjs` (291) | hook `tool.execute.before` catch-all | A | bloqueia WORK_TOOLS quando arm-pending marker existe e run não armado; TTL 30min; teste de contrato passa |
| W1.3 | `src/opencode/pipeline-arm-writer.cjs` | `.claude/hooks/pipeline-arm-writer.cjs` (54) | hook `tui.prompt.append` (B) ou `chat.message` side-effect | B | escreve marker arm-pending quando mensagem é entry-point pipeline; teste passa |

**Esforço:** médio (3 slices, 1 D + 1 A + 1 B).
**Risco:** médio. W1.3 depende de `tui.prompt.append` suportar side-effect write + injeção de contexto. Verificar empiricamente antes de presumir.
**Ponto de decisão:** se `tui.prompt.append` não suportar injeção de systemMessage, W1.3 vira category C (marker write silencioso + regra prompt-native no SKILL.md).

---

### W2 — Step ledger

**Goal:** enforcement de ordem de steps — sem isso, agente pode pular fases.

**Slices:**

| # | Slice | Origem canônica | Alvo porta | Categoria | Aceitação |
|---|---|---|---|---|---|
| W2.1 | `src/lib/step-ledger.cjs` (já em W0.5) | `lib/step-ledger.cjs` (121) | porta direta D | D | exports `decideStep`, `requiredStepsFor`, `stepForAgent`, `decideAgentSpawn`, `STEP_MANIFESTS`, `AGENT_STEP_MAP` |
| W2.2 | `src/opencode/step-ledger-gate.cjs` | `.claude/hooks/step-ledger-gate.cjs` (140) | hook `tool.execute.before` para `agent` | A | bloqueia spawn se step_ledger não tem passos prévios estampados; fail-closed em CORRUPT_SENTINEL governado; teste passa |
| W2.3 | `src/opencode/step-ledger-stamp.cjs` | `.claude/hooks/step-ledger-stamp.cjs` (204) | hook `tool.execute.after` para `agent` | A | estampa step em state.step_ledger + bumps contadores; DoD #6: só estampa se `hasUsableResult(tool_response)`; teste passa |
| W2.4 | `src/lib/fix-loop.cjs` (já em W0.5) | `lib/fix-loop.cjs` (38) | porta direta D | D | exports `decideFixLoop`, `DEFAULT_MAX` |

**Esforço:** médio (4 slices).
**Risco:** médio. W2.3 depende do shape `tool_response` do OpenCode — verificar formato do result do agente OpenCode antes de portar `hasUsableResult`.

---

### W3 — Verdict gates

**Goal:** gates que bloqueiam avanço baseado em verdicts de fases anteriores.

**Slices:**

| # | Slice | Origem canônica | Alvo porta | Categoria | Aceitação |
|---|---|---|---|---|---|
| W3.1 | `src/opencode/batch-review-gate.cjs` | `.claude/hooks/batch-review-gate.cjs` (128) | hook `tool.execute.before` para `agent` | A | bloqueia checkpoint-validator/final-validator quando batch_reviews_done < batch_checkpoints_done; teste passa |
| W3.2 | `src/opencode/checkpoint-verdict-gate.cjs` | `.claude/hooks/checkpoint-verdict-gate.cjs` (124) | hook `tool.execute.before` para `agent` | A | A1: deny advance em checkpoint RED; A2/A3: STOP_RULE após 2 falhas consecutivas; teste passa |
| W3.3 | `src/opencode/phase-verdict-gate.cjs` | `.claude/hooks/phase-verdict-gate.cjs` (74) | hook `tool.execute.before` para `agent` | A | A5-A9: SSOT_CONFLICT, INFO_GATE_BLOCKED, PLAN_REJECTED, FINAL_ADVERSARIAL_REWORK, GO_NOGO_BLOCK; teste passa |
| W3.4 | `src/opencode/gate-log-gate.cjs` | `.claude/hooks/gate-log-gate.cjs` (122) | hook `tool.execute.before` para `agent` | A | bloqueia executor-controller se TDD_APPROVAL ausente; bloqueia final-validator se ADVERSARIAL_GATE ausente; fail-closed em CORRUPT_SENTINEL; teste passa |

**Esforço:** alto (4 hooks A, todos dependem de W0 + W2).
**Risco:** médio. Todos categoria A — tradução direta. Dependência de W0.1 (SSOT descoberta) e W0.5 (guards PURE).

---

### W4 — Dispatch enforcement

**Goal:** obrigar dispatch de subagentes (parent não pode trabalhar inline enquanto handshake pendente) + registrar dispatch com envelope.

**Slices:**

| # | Slice | Origem canônica | Alvo porta | Categoria | Aceitação |
|---|---|---|---|---|---|
| W4.1 | `src/opencode/dispatch-pending-gate.cjs` | `.claude/hooks/dispatch-pending-gate.cjs` (219) | hook `tool.execute.before` catch-all | A | bloqueia WORK_TOOLS do parent enquanto handshake pending vivo; ALWAYS_ALLOW_TOOLS mapeado para nomes OpenCode; teste passa |
| W4.2 | `src/opencode/dispatch-record-hook.cjs` | `.claude/hooks/dispatch-record-hook.cjs` (280) | hook `tool.execute.before` para `agent` | A | persiste pending_dispatches[dispatch_id] no state; **updatedInput**: retorna `{ input: { ...original, prompt: enveloped } }`; teste passa |

**Esforço:** alto (2 hooks A, W4.2 usa updatedInput — verificar se OpenCode SDK suporta modificar output.args do prompt do subagente).
**Risco:** médio-alto. W4.2 depende de `tool.execute.before` poder modificar `output.args.prompt` para o subagente. A doc mostra exemplos com `bash` command e `read` filePath, mas não com `agent` prompt. Verificar empiricamente.
**Ponto de decisão:** se `output.args.prompt` não for modificável para `agent` tool, W4.2 vira category C (envelope injetado por outro caminho — ex: prompt do agent antes do dispatch via `tui.prompt.append` ou regra prompt-native).

---

### W5 — Specialized gates

**Goal:** gates especializados (scope lock, spec seal, parallel dispatch).

**Slices:**

| # | Slice | Origem canônica | Alvo porta | Categoria | Aceitação |
|---|---|---|---|---|---|
| W5.1 | `src/opencode/scope-lock-hook.cjs` (mod) | `.claude/hooks/scope-lock-hook.cjs` (424) | hook `tool.execute.before` para edit/write | A | forbidden_files denylist + allowed_files allowlist + REFACTOR_SCOPE_LOCK gate; teste passa |
| W5.2 | `src/opencode/spec-seal-guard.cjs` | `.claude/hooks/spec-seal-guard.cjs` (273) | hook `tool.execute.before` para bash | A | DONE 2026-06-23: bloqueia `run-seal.cjs` se spec_review_done !== true; checa multiplas invocacoes; teste passa; evidencia em `tmp/w5-2-spec-seal-guard-evidence.md` |
| W5.3 | `src/opencode/parallel-dispatch-gate.cjs` | `.claude/hooks/parallel-dispatch-gate.cjs` (254) | hook `tool.execute.before` para `agent` | A | DONE 2026-06-23: warn-first structural gate para parallel_dispatch_expected; hard deny suprimido para estado schema-only; teste passa; evidencia em `tmp/w5-3-parallel-dispatch-gate-evidence.md` |

**Esforço:** médio (3 hooks A).
**Risco:** baixo. Todos categoria A.

---

### W6 — Telemetry

**Goal:** registrar respostas de pergunta ao usuário + telemetria Langfuse.

**Slices:**

| # | Slice | Origem canônica | Alvo porta | Categoria | Aceitação |
|---|---|---|---|---|---|
| W6.1 | `src/opencode/human-gate-record.cjs` | `.claude/hooks/human-gate-record.cjs` (135) | hook `permission.replied` + `question.replied` + `event` (observer) | A | DONE 2026-06-23: append HUMAN_GATE/AUDIT/CONFIRMED em gate-decisions.jsonl; resposta real obrigatoria; redaction aplicada; teste passa; evidencia em `tmp/w6-1-human-gate-record-evidence.md` |
| W6.2 | `src/opencode/langfuse-hook.cjs` (mod) | `.claude/hooks/langfuse-hook.cjs` (813) | hooks `tool.execute.before` + `tool.execute.after` para `agent` | A+B | span start/end com metadados do subagente; opt-in via LANGFUSE_ENABLED; teste passa |
| W6.3 | `src/lib/langfuse-client.cjs` + `langfuse-carrier.cjs` + `langfuse-sanitizer.cjs` | `lib/langfuse-*.cjs` | porta direta D | D | exports confirmados; testes passam |

**Esforço:** médio (3 slices, 1 observer + 1 A+B + 1 D).
**Risco:** baixo. Telemetria não bloqueia. W6.1 usa `permission.replied` que é observer por design.

---

### W7 — Stop-layer (GAP-FERRAMENTA)

**Goal:** pattern alternativo para Stop gate (sem equivalente no harness OpenCode) + telemetria de stop + cleanup.

**Slices:**

| # | Slice | Origem canônica | Alvo porta | Categoria | Aceitação |
|---|---|---|---|---|---|
| W7.1 | `src/opencode/stop-gate-pattern.cjs` | `.claude/hooks/stop-gate-hook.cjs` (244) | pattern alternativo C | C | (1) regra prompt-native forte em SKILL.md; (2) hook `session.idle` observer que registra `PIPELINE_STOP_ATTEMPT` em protocol-events.jsonl; (3) write do terminal `hard_failed` após 3 continuities; teste passa |
| W7.2 | `src/opencode/stop-hook.cjs` (mod) | `.claude/hooks/stop-hook.cjs` (842) | hook `session.idle` observer | B | append run-log.jsonl + fidelity report; teste passa |
| W7.3 | `src/opencode/session-cleanup-hook.cjs` (mod) | `.claude/hooks/session-cleanup-hook.cjs` (116) | hook `session.idle` observer | B | unlink de locks expirados; teste passa |
| W7.4 | `src/opencode/compaction-bridge.cjs` | (novo — não existe no canônico) | hook `experimental.session.compacting` | Bônus | injeta estado do run (runId, fase atual, gates pendentes) no prompt de compactação; teste passa |

**Esforço:** médio (4 slices, 1 pattern C + 2 observers B + 1 bônus).
**Risco:** alto. W7.1 é GAP-FERRAMENTA — perda inevitável de teeth. Documentar explicitamente no CHANGELOG que o stop block é prompt-native + auditoria pós-fato, não block determinístico.
**Mitigação:** W7.4 (compaction bridge) é a compensação — se a sessão for compactada em vez de parada, o estado do run é preservado no prompt de continuação.

---

### W8 — Hooks modificados

**Goal:** portar os 11 hooks modificados do canônico que pré-existentes mas cresceram muito.

**Slices:**

| # | Slice | Origem canônica | Alvo porta | Categoria | Aceitação |
|---|---|---|---|---|---|
| W8.1 | `src/opencode/dispatch-guard.cjs` (mod) | `.claude/hooks/dispatch-guard.cjs` (1160) | hook `tool.execute.before` para skill/agent | A+B | Plan-Mode/Brainstorm bypass detection + STEP 1.7 routing; teste passa |
| W8.2 | `src/opencode/edit-guard-hook.cjs` (mod wrapper) | `.claude/hooks/edit-guard-hook.cjs` (769) | hook `tool.execute.before` para edit/write/bash | A | write-lock + exec-window + dispatch-pending lock + Plan-Mode gate + shell-write; usa SSOT de W0.1; teste passa |
| W8.3 | `src/opencode/force-pipeline-agents.cjs` (mod) | `.claude/hooks/force-pipeline-agents.cjs` (334) | hook `tui.prompt.append` | B | lembrete de forçar agents pipeline; teste passa |
| W8.4 | `src/opencode/session-lock-hook.cjs` (mod) | `.claude/hooks/session-lock-hook.cjs` (191) | hook `tui.prompt.append` ou `session.created` | B | cria session lock em pipeline entry-points; teste passa |
| W8.5 | `src/opencode/sentinel-hook.cjs` (mod) | `.claude/hooks/sentinel-hook.cjs` (541) | hook `tool.execute.before` para `agent` | A | checkpoint enforcement; expected_next array (parallel fan-out); teste passa |
| W8.6 | `src/opencode/skill-frontmatter-parser.cjs` (mod) | `.claude/hooks/skill-frontmatter-parser.cjs` (235) | hook `tool.execute.before` para `skill` | A | frontmatter contract enforcement; parser é D; teste passa |

**Esforço:** alto (6 hooks, 3 A + 3 B, sendo W8.1 e W8.2 grandes).
**Risco:** médio. W8.1 (dispatch-guard 1160 linhas) é o maior hook do canônico — precisa leitura completa antes de portar.

---

### W9 — Agentes + skills + commands

**Goal:** portar os prompts de agentes e skills canônicos, adaptando nomes de tools (`Agent`→`Task`, `AskUserQuestion`→`question`).

**Slices:**

| # | Slice | Origem canônica | Alvo porta | Aceitação |
|---|---|---|---|---|
| W9.1 | Expandir 8 agentes existentes | `agents/core/*.md` + `agents/executor/*.md` + `agents/quality/*.md` | prompts detalhados com step-by-step + gate protocol wiring; cada agente ≥ 50 linhas; testes de prompt authenticity passam |
| W9.2 | Portar agentes type-specific faltantes | `agents/executor/type-specific/*.md` (21 arquivos: bugfix-diagnostic, root-cause-analyzer, regression-tester, feature-implementer, integration-validator, slice-planner, audit-intake, domain-analyzer, compliance-checker, risk-matrix-generator, ux-simulator, qa-validator, accessibility-auditor, spec-format-gate, content-reviewer, adversarial-critic, post-impl-validator, adversarial-review-coordinator, adversarial-architecture-critic, adversarial-quality-reviewer, adversarial-security-scanner) | 21 novos agentes em `.opencode/agents/`; testes passam |
| W9.3 | Expandir skill `pipeline-orchestrator` | `skills/pipeline/SKILL.md` + `skills/pipeline/SKILL.v3-reference.md` | SKILL.md detalhado com fases, gates, Iron Laws; ≥ 100 linhas |
| W9.4 | Portar skills de modo (10) | `skills/bugfix-light/` + `bugfix-heavy/` + `feature-light/` + `feature-heavy/` + `audit-light/` + `audit-heavy/` + `ux-sim-light/` + `ux-sim-heavy/` + `spec-light/` + `spec-heavy/` (com step files) | 10 skills com step files em `.opencode/skills/`; testes passam |
| W9.5 | Portar skills auxiliares | `skills/pipeline-contracts`, `pipeline-tdd`, `pipeline-adversarial-review`, `verify-completion` | expandir as 3 skills existentes + 1 nova |
| W9.6 | Commands: adicionar `help` | `commands/help.md` | novo command em `opencode.json` |

**Esforço:** alto (6 slices, volume grande de prompts para adaptar).
**Risco:** médio. Adaptação de nomes de tools é mecânica mas volume é grande.
**Pré-requisito:** W0-W8 prontos (runtime enforcement) para que os prompts dos agentes possam referenciar gates que realmente existem.

---

### W10 — Infra

**Goal:** portar módulos lib de infraestrutura + registro de hooks.

**Slices:**

| # | Slice | Origem canônica | Alvo porta | Aceitação |
|---|---|---|---|---|
| W10.1 | `src/lib/run-seal.cjs` | `lib/run-seal.cjs` (563) | porta direta D | `sealSpecRun` + 4 pre-seal preconditions; teste passa |
| W10.2 | `src/lib/step-1-7-routing.cjs` | `lib/step-1-7-routing.cjs` (275) | porta direta D | `appendStep17Routing`, `branchToCanonical`, `BRANCH_VALUES`; teste passa |
| W10.3 | `src/lib/run-directory.cjs` (mod) | `lib/run-directory.cjs` (234) | porta adaptada D | `allocate()` escreve active-run.json + sentinel-state.json; teste passa |
| W10.4 | `src/lib/fidelity-reporter.cjs` (mod) | `lib/fidelity-reporter.cjs` (600) | porta adaptada D | `mandatorySetFor(complexity, type, variant)` flow-aware; teste passa |
| W10.5 | `src/lib/run-log.cjs` + `run-manifest.cjs` + `gate-decision-writer.cjs` + `jsonl-sanitizer.cjs` (mods) | `lib/*.cjs` | porta direta D | exports confirmados; testes passam |
| W10.6 | Registro de hooks no plugin manifest | `hooks/hooks.json` (218) | traduzir para `opencode.json` + plugin export | todos os hooks W1-W8 registrados; plugin carrega sem erro; smoke test passa |

**Esforço:** médio (6 slices, todos D exceto W10.6).
**Risco:** baixo. Maioria categoria D.

---

### W11 — E2E parity tests

**Goal:** validar paridade end-to-end rodando um bugfix-light real e comparando com Claude Code.

**Slices:**

| # | Slice | Alvo | Aceitação |
|---|---|---|---|
| W11.1 | Teste E2E bugfix-light | rodar `Task` dispatch real com pipeline-orchestrator skill | `gate-decisions.jsonl` + `protocol-events.jsonl` + `evidence.jsonl` produzidos; mesmos gates disparam nas mesmas fases que o canônico |
| W11.2 | Comparação de paridade | diff dos JSONL da porta vs canônico para mesmo input | ≥ 90% dos gates coincidentes; divergências documentadas e justificadas |
| W11.3 | Teste E2E feature-heavy | idem para feature-heavy | batches + slices + checkpoints + adversarial review; evidência completa |

**Esforço:** médio (3 slices de teste E2E).
**Risco:** médio. Pode revelar gaps não vistos nos testes de contrato.
**Pré-requisito:** W0-W10 prontos.

---

## 4. Ontras deferidas (GAP-ESCOPO)

| Item | Origem canônica | Justificativa do deferimento |
|---|---|---|
| Paperclip integration | `commands/paperclip-*.md` (9) + `skills/measure-paperclip-fidelity` | ecossistema Paperclip não é alvo da porta OpenCode |
| Refactor mode | `skills/refactor-light/` + `refactor-heavy/` | modo não está nos 11 commands da porta; deferir até W9 completo |
| User-story mode | `skills/user-story-light/` + `user-story-heavy/` | idem |
| Brainstorm mode | `agents/brainstorm/` + `skills/brainstorm` | idem |
| Review/measure/validate skills | `skills/review`, `measure-paperclip-fidelity`, `validate-design`, `validate-gap`, `verify-completion` | skills auxiliares; `verify-completion` pode ser portado em W9 se prioritário |
| Spec-authoring flow (spec-controller + run-seal) | `agents/core/spec-controller.md` + `lib/run-seal.cjs` | fluxo específico de spec-authoring; run-seal portado em W10 mas spec-controller deferido |
| Codex operational runtime | `lib/codex-operational-runtime.cjs` (963) | runtime específico do Codex; não aplicável ao OpenCode |

---

## 5. Pontos de decisão que precisam de input

Estes pontos surgem durante a execução e precisam de decisão do usuário antes de continuar:

| # | Ponto | Contexto | Quando surge |
|---|---|---|---|
| D1 | `tui.prompt.append` suporta injeção de systemMessage ou só append de texto? | W1.3 (pipeline-arm-writer) depende disso para category B vs C | Antes de W1.3 |
| D2 | `tool.execute.before` pode modificar `output.args.prompt` para `agent` tool? | W4.2 (dispatch-record-hook com updatedInput) depende disso | Antes de W4.2 |
| D3 | `tool.execute.before` pode ser registrado como catch-all (sem filtro de tool)? | W1.2 (pipeline-arm-gate) e W4.1 (dispatch-pending-gate) são catch-all | Antes de W1.2 |
| D4 | Qual o shape `tool_response` do OpenCode para subagentes? | W2.3 (step-ledger-stamp) precisa mapear `hasUsableResult` | Antes de W2.3 |
| D5 | O `pipeline-guard.js` está sendo carregado pelo OpenCode em runtime? | Sem isso, nem os 4 enforcements atuais rodam | Antes de qualquer porta |
| D6 | Onde armazenar a chave HMAC (ou equivalente de assinatura de estado)? | Por design a porta usa schema validation, mas se decidir portar HMAC no futuro | Futuro |

**Para D1-D4:** verificar empiricamente criando um plugin de teste mínimo que exercita cada primitiva. Se a primitiva não suportar o necessário, classificar como GAP-FERRAMENTA e documentar pattern alternativo.

**Para D5:** criar um plugin de teste que faz `console.log` em `tool.execute.before` e verificar se aparece no log do OpenCode ao rodar uma tool.

---

## 6. Critérios de aceite gerais (aplicáveis a toda onda)

1. `npm test` permanece verde (59+ testes, acrescendo novos).
2. CHANGELOG.md registra a porta com referência à versão canônica de origem.
3. Cada slice tem teste de contrato antes da implementação (TDD).
4. Nenhum arquivo do canônico é modificado.
5. Nomes canônicos de gates, eventos e schemas são preservados.
6. Limites do harness (GAP-FERRAMENTA) são documentados no CHANGELOG com pattern alternativo.
7. A baseline canônica portada é declarada no `package.json` (ex: `"canonical-baseline": "8.9.0"`).

---

## 7. Ordem recomendada de execução

```
W0 (SSOT + lib D)  ←── pré-requisito de tudo
├─ W1 (arm flow)
├─ W2 (step ledger)
│  └─ W3 (verdict gates) ←── precisa W0 + W2
├─ W4 (dispatch enforcement) ←── precisa W0 + W1
├─ W5 (specialized gates) ←── precisa W0
├─ W6 (telemetry) ←── precisa W0
├─ W7 (stop-layer) ←── precisa W0
│  └─ W8 (hooks modificados) ←── precisa W0-W7
│     └─ W9 (agentes + skills) ←── precisa W0-W8 (runtime pronto)
│        └─ W10 (infra) ←── precisa W0-W9
│           └─ W11 (E2E parity tests) ←── precisa W0-W10
```

**Paridade alvo por marco:**
- Após W0-W3: paridade de enforcement ~30% (4 + 8 enforcements = 12/28+)
- Após W0-W7: paridade de enforcement ~70% (4 + 22 enforcements = 26/28+)
- Após W0-W9: paridade de prompts/skills ~70% (agentes + skills portados)
- Após W0-W11: paridade operacional verificada por E2E

---

## 8. Métricas de acompanhamento

| Métrica | Baseline (v0.2.0) | Meta W0-W3 | Meta W0-W7 | Meta W0-W11 |
|---|---|---|---|---|
| Enforcements vivos | 4 | 12 | 26 | 28+ |
| Paridade de enforcement | ~14% | ~43% | ~93% | ~100% |
| Agentes portados | 8 stubs | 8 stubs | 8 stubs | 29+ detalhados |
| Skills portadas | 4 finas | 4 finas | 4 finas | 14+ com step files |
| Testes | 59 | 59 + novos | 59 + novos | 59 + novos + E2E |
| Versão canônica baseline | v7.8.0 | v8.9.0 | v8.9.0 | v8.9.0 |

---

## 9. Riscos e mitigações do plano

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| `tui.prompt.append` não suporta systemMessage inject (D1) | Média | Médio | W1.3 vira category C; marker write silencioso + regra prompt-native |
| `tool.execute.before` não pode modificar `agent` prompt (D2) | Média | Alto | W4.2 vira category C; envelope injetado via prompt do agent antes do dispatch |
| `tool.execute.before` catch-all não existe (D3) | Baixa | Alto | Registrar para cada WORK_TOOL individualmente (edit, write, bash, agent) |
| `pipeline-guard.js` não está sendo carregado (D5) | Baixa | Crítico | Verificar antes de W1; se não, registrar em `opencode.json` plugin array |
| Stop gate pattern alternativo não tem teeth suficiente (W7) | Alta | Alto | Documentar perda; compensar com `experimental.session.compacting` (W7.4) + regra prompt-native de alta saliência |
| Volume de W9 (agentes + skills) é maior que estimado | Média | Médio | Quebrar W9 em sub-ondas; priorizar agentes core (run-orchestrator, planner, implementer, pre-tester, validator) antes dos type-specific |
| Novo release canônico durante a execução do plano | Alta | Médio | A cada release canônica, rodar diff do `ENFORCEMENT-CANONICAL-MAP.md` e adicionar novos enforcements como onda adicional |

---

## 10. Próxima ação

**Iniciar W0.1** — criar `src/state/sentinel-state-inspector.cjs` extraindo `findActiveSentinelState`, `discoverStatePath`, `findLivePendingBlock`, `isExemptPath`, `CORRUPT_SENTINEL` do `edit-guard-hook.cjs` canônico. Escrever teste de contrato antes (TDD). Declarar baseline v8.9.0 no `package.json`.

Antes de W0.1, **verificar D5** (se `pipeline-guard.js` está sendo carregado pelo OpenCode) — sem isso, qualquer porta de enforcement é simbólica.
