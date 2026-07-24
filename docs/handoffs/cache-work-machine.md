# Retomada do módulo de cache — máquina do trabalho

## Escopo protegido

- Repositório: `entretenimento-sexual/entretenimento`
- Branch exclusiva: `feat/cache-architecture-foundation`
- Pull request: `#38`
- Estado esperado do PR: aberto, em rascunho e sem merge
- Base: `main`

Não criar outra branch, não fazer rebase, não usar `reset --hard`, não alterar `main`, não fazer merge e não executar deploy durante esta etapa.

## Estado deixado pela sessão anterior

A arquitetura tipada e privacy-first já cobre:

- `AppCacheService` com memória, persistência opt-in, TTL, stale window, versão e escopo por UID;
- proteção contra reidratação tardia de leitura IndexedDB invalidada;
- escrita nova vencendo leitura persistente antiga ainda em voo;
- limpeza em logout, sessão nula e troca de conta;
- preferências íntimas, localização e perfis privados somente em memória;
- remoção do slice genérico de cache do NgRx;
- remoção do `CacheSyncService` sem consumidores;
- descoberta pública separada por viewer e por identidade semântica dos filtros;
- resultados vazios tratados como cache hit legítimo;
- busca por UIDs com identidade determinística e retorno na ordem solicitada;
- links sociais privados e públicos com chaves e sensibilidades distintas.

## Resultado da última validação executada

A execução anterior terminou com:

- 132 arquivos de teste aprovados;
- 396 testes aprovados;
- 1 teste reprovado em `UserDiscoveryQueryService`;
- build `dev-emu` aprovado.

A reprovação não indicava leitura Firestore executada. O teste contava a criação de um Observable frio como se fosse assinatura. Depois dessa execução, o teste foi corrigido para medir assinatura real da fonte.

Também foram adicionados depois da última validação:

- migração de `UserSocialLinksService` para `AppCacheService`;
- separação entre documento privado do dono e espelho público;
- bloqueio definitivo da opção legada `persistCache` para links sociais;
- testes de isolamento privado, público autenticado e público anônimo;
- proteção de corrida entre leitura persistente, `set$()`, invalidação e limpeza;
- testes garantindo que logout/limpeza não permitam reidratação posterior;
- script seguro de retomada desta branch.

Por isso, a suíte completa e o build precisam ser executados novamente antes de ampliar a migração.

## Primeira abertura na máquina do trabalho

No PowerShell:

```powershell
cd C:\entretenimento

git status --short
git fetch origin --prune
git switch feat/cache-architecture-foundation
git pull --ff-only origin feat/cache-architecture-foundation

powershell -ExecutionPolicy Bypass -File .\scripts\dev\resume-cache-work-session.ps1 -Install -Validate
```

O script:

- interrompe se houver alterações locais;
- atualiza somente por fast-forward;
- não executa merge, rebase, reset ou deploy;
- exige Node.js 22;
- procura automaticamente Node 22 portátil em `%USERPROFILE%\.nodes\node-22`;
- usa `npm ci` quando solicitado;
- executa `test:ci` e `build:emu` com `-Validate`.

## Caso o projeto não esteja em `C:\entretenimento`

Entre na pasta real do repositório e execute os mesmos comandos. O script resolve a raiz com base em sua própria localização.

## Resultado mínimo exigido

A etapa só pode avançar quando ambos concluírem sem erro:

```powershell
npm.cmd run test:ci
npm.cmd run build:emu
```

Na validação dos testes, observar especialmente:

- `user-discovery.query.service.spec.ts`;
- `user-social-links.service.spec.ts`;
- `app-cache.service.spec.ts`;
- `cache-session-lifecycle.service.spec.ts`;
- `cache-auth-lifecycle-bridge.service.spec.ts`;
- `user-preferences.service.spec.ts`.

O `app-cache.service.spec.ts` agora deve cobrir também:

- escrita nova vencendo reidratação antiga;
- limpeza de sessão impedindo repopulação tardia da memória.

## Validação manual no Emulator Suite

Depois da suíte e do build:

1. Iniciar em um terminal com Java 21 e Node 22:

```powershell
npm.cmd run emu:media:start
```

2. Em outro terminal:

```powershell
npm.cmd run start:emu
```

3. Validar:

- login, logout e troca de conta;
- preferências;
- descoberta com dois filtros diferentes;
- descoberta sem resultados;
- busca por UIDs em ordens diferentes;
- links sociais do próprio usuário lendo `users/{uid}/profileData/socialLinks`;
- links sociais de outro usuário lendo apenas `public_social_links/{uid}`;
- leitura anônima somente quando as rules permitirem;
- ausência de chaves `socialLinks:*` no IndexedDB;
- ausência do objeto completo `currentUser` no `localStorage`.

## Próxima tarefa após validação verde

Mapear os consumidores restantes do `CacheService` legado e migrar um serviço social por vez. Prioridade:

1. identificar dados pessoais ou sociais ainda persistíveis;
2. separar contexto do viewer e do alvo;
3. preservar nomes dos métodos públicos;
4. manter APIs Observable-first;
5. atualizar ou invalidar cache após mutations;
6. criar teste de isolamento por UID;
7. documentar qualquer supressão de código e seu motivo.

O arquivo `data-handling/legacy/firestore.service.ts` continua preservado. Ele não deve ser removido antes da busca final de consumidores, substituição, build e testes de integração.

## Encerramento da sessão

Antes de trocar novamente de máquina:

```powershell
git status --short
git log -1 --oneline
git push origin feat/cache-architecture-foundation
```

Registrar no chat:

- HEAD enviado;
- resultado de `test:ci`;
- resultado de `build:emu`;
- qualquer erro do Emulator Suite;
- arquivos alterados localmente que ainda não tenham commit.
