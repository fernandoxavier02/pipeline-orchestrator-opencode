# Changelog — Pipeline Orchestrator OpenCode (standalone)

Todas as mudanças notáveis deste projeto são documentadas aqui.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/).

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
