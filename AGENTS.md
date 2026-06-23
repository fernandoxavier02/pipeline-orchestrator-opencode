# AGENTS.md — Pipeline Orchestrator OpenCode (standalone)

Contexto para agentes (Claude Code, OpenCode, Codex) que trabalharem neste repositório.

## Identidade

Projeto **independente** que porta o Pipeline Orchestrator para o OpenCode. Vive em
`D:\pipeline-orchestrator-claude\Pipeline-Orchestrator-OpenCode\`, sob o mesmo workspace
guarda-chuva do repositório canônico do Claude Code
(`D:\pipeline-orchestrator-claude\claude-code\Pipeline-Orchestrator\`). Os dois NÃO compartilham
arquivos nem pacote npm.

## Iron Law

- **Nunca** modificar o repositório canônico do Claude Code a partir daqui.
- Paridade de comportamento é validada por testes de contrato em `specs/canonical-parity-bugfix/`,
  não por cópia de código do canônico.
- TDD: a suíte (`npm test`, 56 testes) deve permanecer verde antes de declarar qualquer trabalho pronto.

## Layout

| Pasta | Função |
|---|---|
| `src/` | runtime, validators, state, verification (CommonJS) |
| `tests/` | suíte de contrato + unitária |
| `specs/` | spec canonical-parity-bugfix |
| `scripts/` | `run-tests.cjs`, `install.cjs` |
| `.opencode/` | produto instalável (agents, commands, skills, plugins) |
| `opencode.json` | comandos do OpenCode |

## Comandos

```bash
npm test                                              # suíte local
node scripts/install.cjs --target <projeto>           # simular instalação
node scripts/install.cjs --target <projeto> --apply   # instalar artefatos
```

## Publicação (manual, fora do fluxo automático)

- npm: `npm publish` (escopo restrito) — exige autenticação própria.
- git: repositório remoto próprio (`pipeline-orchestrator-opencode` no GitHub), independente do canônico.
