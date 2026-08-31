# Pipeline Orchestrator — OpenCode (standalone)

Adaptação **independente** do Pipeline Orchestrator para o ecossistema [OpenCode](https://opencode.ai).
Este projeto é **totalmente separado** do plugin canônico do Claude Code (repositório
[`Pipeline-Orchestrator`](https://github.com/fernandoxavier02/Pipeline-Orchestrator)):
repositório próprio, pacote npm próprio, execução própria. **Não compartilha código** com o canônico.

- Distribuição: Git standalone
- Runtime: Node.js ≥ 18, CommonJS
- Produto instalável: `.opencode/` (agents, commands, skills, plugins) + `opencode.json`

## O que é

Sistema de governança multi-agente que opera entre planejamento e entrega de código:
classificação de tarefas, gates estruturados, TDD obrigatório, revisão adversarial com
contexto isolado e trilha de auditoria. Cobre os modos bugfix, feature, audit, UX e SPEC,
cada um em variante leve e pesada.

## Instalação

```bash
# clonar o repositório
git clone https://github.com/fernandoxavier02/pipeline-orchestrator-opencode.git
cd pipeline-orchestrator-opencode

# instalar globalmente no OpenCode deste computador
node scripts/install.cjs --global --apply

# simular a instalação em um projeto específico (não escreve nada)
node scripts/install.cjs --target /caminho/do/projeto

# aplicar em um projeto específico
node scripts/install.cjs --target /caminho/do/projeto --apply
```

O comando copia os artefatos do `.opencode/` (agents, skills, plugins, commands) e o
`opencode.json` para o projeto-alvo. A instalação **global** grava em `~/.config/opencode/`,
usa o layout global do OpenCode e deixa os comandos disponíveis em todos os projetos deste computador.

Se o seu arquivo global do OpenCode tiver chaves de provedores gravadas diretamente, a instalação
global para e pede aprovação explícita antes de migrar esses segredos para variáveis de ambiente.
Nesse caso, rode novamente com `--migrate-provider-secrets` somente se você aprovar essa migração.

## Como usar

Depois da instalação global, abra qualquer projeto no OpenCode e use um destes comandos:

- `/pipeline`: fluxo completo governado.
- `/bugfix`: correção de bug com roteamento automático.
- `/bugfix-light` e `/bugfix-heavy`: correções leves ou pesadas.
- `/feature-light` e `/feature-heavy`: entrega de funcionalidade.
- `/audit-light` e `/audit-heavy`: auditoria somente leitura.
- `/ux-light` e `/ux-heavy`: revisão de experiência do usuário.
- `/spec-light` e `/spec-heavy`: criação ou revisão de especificação.
- `/verify-completion`: verifica evidências antes de declarar pronto.
- `/Pipeline Orchestrator Help`: mostra o guia de uso dentro do OpenCode.

## Verificação

```bash
node scripts/run-tests.cjs
```

## Estrutura

```
.
├─ src/          runtime, validators, state, verification
├─ tests/        suíte de contrato + unitária
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
