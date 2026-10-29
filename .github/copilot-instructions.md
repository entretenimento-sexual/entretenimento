# Copilot Instructions for AI Agents

## REGRA OBRIGATÓRIA: SOMENTE MAIN — SEM BRANCH, MERGE OU PR

**Ordem expressa do proprietário do repositório. Aplica-se a agentes de IA, automações e colaboradores.**

1. **NÃO criar branches novas**, locais ou remotas, nem worktrees de desenvolvimento, mesmo para correções pequenas, experimentos, testes ou organização.
2. **NÃO criar, abrir, atualizar ou empilhar Pull Requests (PRs)** para novas implementações. PRs antigos não autorizam continuar trabalhando em branches deles.
3. **NÃO executar merges** (nem `git merge`, merge de PRs, merge commits, `git rebase` ou `git cherry-pick` para integrar trabalho). Não usar estratégias equivalentes para contornar esta proibição.
4. **Trabalhar exclusivamente na branch `main` existente**, com alterações pequenas, delimitadas, testes e commits diretos. Antes de gravar, confirmar o HEAD remoto; nunca forçar push nem sobrescrever alterações concorrentes.
5. **Se houver qualquer bloqueio para editar a `main` com segurança, interromper a operação e informar o impedimento.** Nunca criar branch ou PR como alternativa automática.
6. **Sem deploy, migração/destruição de dados, alterações no Firebase real ou remoção de arquivos de testes** sem autorização explícita e separada. Preservar arquivos locais não rastreados (incluindo galerias e backups); não executar `git clean` ou `git reset --hard`.
7. **A regra só muda com uma nova ordem explícita do proprietário**, para a operação específica. Uma prática de Git recomendada, convenção de ferramenta ou sugestão do assistente não substitui essa ordem.

Fluxo: `git branch --show-current` deve retornar `main`; conferir `git status --short`; usar `git pull --ff-only origin main` quando seguro; editar apenas o escopo combinado; testar; realizar commit direto na `main` e verificar o CI. **Não criar branch, não fazer merge e não criar PR.**


## Visão Geral do Projeto
- Projeto Angular + Firebase para uma plataforma de entretenimento social.
- Backend serverless com Cloud Functions (pasta `functions/`).
- Frontend modularizado em `src/app/` (componentes, módulos, serviços).
- Utiliza Angular 20+, AngularFire, NGXS, Jest, ESLint, Bootstrap.

## Estrutura e Padrões
- **Componentes**: Use `ng generate component` para criar novos componentes. Componentes são organizados por domínio (ex: `subscriptions/`, `chat-module/`, `admin-dashboard/`).
- **Serviços**: Serviços Angular são injetados via `providedIn: 'root'`. Serviços de dados e autenticação ficam em `core/services/`.
- **State Management**: NGXS é usado para gerenciamento de estado global.
- **Estilos**: CSS modular por componente. Use classes utilitárias do Bootstrap quando possível.
- **Testes**: Use Jest para testes unitários (`ng test` ou `npm test`). Mocks e stubs ficam em `test/jest-stubs/`.
- **Lint**: Siga as regras do ESLint. Scripts e configs em `eslint.config.mjs` e `.eslintrc.js`.

## Fluxos de Desenvolvimento
- **Build**: `npm run build` ou `ng build` (output em `dist/`).
- **Dev Server**: `npm start` ou `ng serve` (http://localhost:4200).
- **Testes**: `npm test` ou `ng test` (Jest). Não use Karma.
- **Emuladores Firebase**: `npm run emulators:start` para rodar localmente.
- **Deploy**: não executar deploy de Functions, Rules ou Hosting sem autorização explícita separada; testes devem usar emuladores.

## Integrações e Dependências
- **Firebase**: Autenticação, Firestore, Functions, Emuladores. Configs em `firebase.json` e `environments/`.
- **Cloud Functions**: Código em `functions/src/`. Use TypeScript, siga padrões do Firebase Functions.
- **AngularFire**: Use serviços do AngularFire para acesso ao Firebase.
- **Bootstrap**: Classes utilitárias disponíveis globalmente.

## Convenções Específicas
- **Chaves de cache**: Sempre normalize para lower-case. Use prefixos como `notFound:` para controle de TTL.
- **Arquitetura**: Separe lógica de domínio em serviços. Componentes devem ser "burros" sempre que possível.
- **Standalone Components**: Alguns componentes usam `standalone: true` (Angular 15+). Prefira quando possível.
- **Observables**: Use RxJS para fluxos assíncronos. Prefira `async/await` apenas em serviços.
- **Rotas**: Definidas por módulo. Use lazy loading para módulos grandes.

## Exemplos de Arquivos-Chave
- `src/app/core/services/data-handling/firestore.service.ts`: Acesso centralizado ao Firestore.
- `src/app/core/services/general/cache/cache.service.ts`: Padrões de cache e TTL.
- `src/app/app.component.ts`: Orquestração de sessão e listeners globais.
- `functions/src/index.ts`: Entrypoint das Cloud Functions.

## Dicas para Agentes
- Sempre consulte os serviços em `core/services/` antes de criar lógica duplicada.
- Prefira integração via Observables/RxJS para comunicação entre componentes e serviços.
- Siga os scripts do `package.json` para builds, testes e emuladores.
- Consulte `README.md` para comandos básicos e estrutura geral.

---

Seções incompletas ou dúvidas? Peça exemplos de padrões ou fluxos específicos encontrados no código.

## Fluxo Git obrigatório — main única

- A `main` é a única linha ativa de desenvolvimento deste repositório.
- Proibido criar branches, worktrees, PRs ou executar merges. Consulte `AGENTS.md`; não usar PRs já abertos como fluxo de novas implementações.
- Alterações autorizadas devem ser aplicadas diretamente na `main`, em commits pequenos e verificáveis.
- Não reativar funcionalidades removidas/congeladas a partir de branches antigas, PRs fechadas ou código preservado por compatibilidade.
- Não criar superfícies paralelas de conversa em Comunidades sem solicitação explícita do proprietário; o Mural é a superfície canônica de conversa.
- Nenhum deploy de produção é autorizado apenas por uma alteração de código; produção exige autorização explícita separada.
