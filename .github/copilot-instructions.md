# Copilot Instructions for AI Agents

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
- **Deploy**: Use comandos do Firebase CLI para deploy de funções e regras.

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