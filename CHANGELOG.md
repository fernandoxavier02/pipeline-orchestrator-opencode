# Changelog — Pipeline Orchestrator OpenCode (standalone)

Todas as mudanças notáveis deste projeto são documentadas aqui.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/).

## [0.2.0] — 2026-06-17

### Added — Plan-Mode gate (paridade com o Claude Code v8.2.1)
- **Trava de Plan Mode determinística**: nenhum código de produção é escrito num run sem um plano aprovado registrado no estado. `src/opencode/plan-gate.cjs` (`armPlanGate`/`approvePlanGate`/`rejectPlanGate`, `planRequiredFor`) grava `planGate` no `sentinel-state.json` via `loadSentinel`/`saveSentinel`; `approve`/`reject` exigem `arm` prévio (forge guard, espelha o CORR-3 do Claude Code).
- **Campo `planGate`** validado pelo `contract-validator.cjs` (malformado → `PLAN_GATE_INVALID`, fail-closed; ausente → válido, retrocompat) + helper `isPlanGateArmed`.
- **Enforcement no `guardToolExecution`** (`plugin-guard.cjs`): bloqueia `edit`/`write` (`PLAN_GATE_ACTIVE`) e comandos de escrita via `bash` (`PLAN_GATE_TERMINAL_BLOCKED` — fecha o furo de terminal que o guard não cobria) quando a trava está armada; fail-closed se `planGate` malformado. Sem desligamento por variável de ambiente.
- **`src/opencode/detect-shell-write.cjs`**: heurística de escrita-no-terminal portada do edit-guard (redirects incl. `>|`, tee, sed -i, cp/mv/ln/dd, node -e, perl/ruby/php -e, cmdlets PowerShell, heredoc), com strip de aspas para evitar falso-positivo em leituras (`grep 'a>b'`).
- Integridade por **validação de schema** (o OpenCode não usa HMAC, por design — o mapa de portabilidade troca `writeSignedState`/HMAC por `saveSentinel`/schema).
- Testes: `tests/unit/plan-gate-state.test.cjs`, `tests/unit/plan-gate-record.test.cjs`, `tests/unit/plan-gate-guard.test.cjs`.

### Note
- O `activeRun` passado ao guard pode conter `planGate` (lido de `loadSentinel().planGate`); ausente = comportamento legado (sem enforcement de plano).
- Portado do Claude Code via dogfood do próprio pipeline (`/pipeline-orchestrator:pipeline`). Invariantes preservadas: fail-closed, plan-gate, shell-write-heuristic, no-env-off-switch, corrupt-blocks (schema), arm-before-approve, isenção por allowedSurfaces.

### Fixed — fix loop pós revisão adversarial (3 revisores zero-context)
- `detectShellWrite`: corrigido false-negative grave — redirect com descritor numerado para arquivo (`2> f`, `1> f`) agora é detectado (antes era ignorado junto com `2>&1`); adicionados `touch`/`mkdir`/`rm`/`rmdir`, `curl -o`/`wget -O`, `tar -x`, `unzip`, `git checkout|apply|restore|stash|reset|clean`, `awk -i inplace`, `python -m`, `Remove-Item`; verbos agora avaliados na string sem aspas (elimina false-positive de `echo "cp ..."`); heredoc avaliado no comando cru.
- `plan-gate.cjs`: decisões agora são "sticky" — `approve`/`reject` exigem `decision === null` (um gate já decidido precisa ser re-armado), fechando o reject-after-approve / approve-after-reject.
- `contract-validator.cjs`: `planGate.decision` restrito ao enum `null | APPROVED | REJECTED` (antes aceitava qualquer string).
- `plugin-guard.cjs`: `guardToolExecution` defensivo em `phase.transition` com `args` ausente (fail-closed, não crash).

### Known limitations / follow-up (da revisão adversarial)
- **Contrato de sourcing (host→guard)**: o enforcement depende de o `getActiveRun()` do host popular `activeRun.planGate` a partir de `loadSentinel().planGate`. Se o host omitir, o guard vê ausência → libera (legado). Follow-up: o guard carregar+validar o sentinel ele mesmo (dado runId/stateRoot) em vez de confiar no chamador.
- **Fail-open no load-seam contra atacante ATIVO**: se o `sentinel-state.json` for deletado/truncado no meio do run, `loadSentinel` devolve default sem `planGate` → desarmado. Mitigado no vetor de terminal (`rm`/`Remove-Item` agora bloqueados enquanto armado); o fix completo (run ativo cujo estado não carrega-e-valida deve falhar fechado) está amarrado ao contrato de sourcing. Modelo de ameaça: agente cooperativo que pula o plano, NÃO atacante ativo — mesma fronteira do edit-guard do Claude Code.
- **`detectShellWrite` é denylist** (conservador, prefere bloquear demais). Uma allowlist read-only seria estritamente mais forte; adiado.

## [0.1.0] — 2026-05-31

### Added
- **Projeto independente.** Extração da adaptação OpenCode para um repositório próprio,
  totalmente separado do plugin canônico do Claude Code (que deixou de empacotar a versão
  OpenCode no seu pacote npm).
- `package.json` publicável como `@fx-studio-ai/pipeline-orchestrator-opencode` (escopo
  restrito), com `files[]`, `publishConfig` e `prepublishOnly: npm test`.
- Comando de instalação `pipeline-orchestrator-opencode-install` (`scripts/install.cjs`):
  modo simulação por padrão, `--apply` para escrever, `--target` para escolher o projeto.
- Contextos próprios: `README.md`, `CHANGELOG.md`, `AGENTS.md`, `.npmignore`, `LICENSE`.

### Origem
- Fonte: cópia verificada da adaptação dentro do repositório canônico
  (`Pipeline-Orchestrator/opencode-adaptation/`), com suíte 54/54 verde no momento da extração.
- Conteúdo preservado 1:1: `src/`, `tests/`, `specs/`, `.opencode/`, `opencode.json`, `plan.md`.

### Notas
- Distribuição npm restrita por design (espelha a política do canônico).
- Instalação global (`~/.config/opencode/`) permanece um passo manual documentado no README.
