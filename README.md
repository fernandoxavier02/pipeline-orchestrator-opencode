# Pipeline Orchestrator — OpenCode (standalone)

Adaptação **independente** do Pipeline Orchestrator para o ecossistema [OpenCode](https://opencode.ai).
Este projeto é **totalmente separado** do plugin canônico do Claude Code (repositório
[`Pipeline-Orchestrator`](https://github.com/fernandoxavier02/Pipeline-Orchestrator)):
repositório próprio, pacote npm próprio, execução própria. **Não compartilha código** com o canônico.

- Pacote npm: `@fx-studio-ai/pipeline-orchestrator-opencode`
- Runtime: Node.js ≥ 18, CommonJS
- Produto instalável: `.opencode/` (agents, commands, skills, plugins) + `opencode.json`

## O que é

Sistema de governança multi-agente que opera entre planejamento e entrega de código:
classificação de tarefas, gates estruturados, TDD obrigatório, revisão adversarial com
contexto isolado e trilha de auditoria. Cobre os modos bugfix, feature, audit, UX e SPEC,
cada um em variante leve e pesada.

## Instalação via npm

```bash
# instalar o pacote
npm install -g @fx-studio-ai/pipeline-orchestrator-opencode

# simular a instalação dos artefatos em um projeto OpenCode (não escreve nada)
pipeline-orchestrator-opencode-install --target /caminho/do/projeto

# aplicar de fato
pipeline-orchestrator-opencode-install --target /caminho/do/projeto --apply
```

O comando copia os artefatos do `.opencode/` (agents, skills, plugins, commands) e o
`opencode.json` para o projeto-alvo. A instalação **global** (`~/.config/opencode/`) usa um
layout diferente (sem o prefixo `.opencode/`) e é feita por cópia manual dos mesmos artefatos —
veja a seção "Instalação global" abaixo.

### Instalação global (manual)

Copie `.opencode/agents`, `.opencode/skills`, `.opencode/plugins`, `.opencode/commands` e
`opencode.json` para `~/.config/opencode/` (os nomes de comando globais usam prefixo `pipeline-`
para evitar colisão).

## Verificação

```bash
npm test      # roda a suíte local (56 testes)
```

## Estrutura

```
.
├─ src/          runtime, validators, state, verification (51 módulos)
├─ tests/        suíte de contrato + unitária (56 testes)
├─ specs/        spec canonical-parity-bugfix
├─ scripts/      run-tests.cjs, install.cjs
├─ .opencode/    produto instalável (agents, commands, skills, plugins)
├─ opencode.json comandos do OpenCode (pipeline, bugfix, feature, audit, ux, spec)
└─ plan.md       plano de adaptação / fidelidade
```

## Relação com o canônico (Iron Law)

Este projeto **não modifica** o plugin canônico do Claude Code e **não é distribuído** junto
com ele. As duas linhas evoluem de forma independente. Paridade de comportamento é validada por
testes de contrato (`specs/canonical-parity-bugfix/`), não por compartilhamento de arquivos.
