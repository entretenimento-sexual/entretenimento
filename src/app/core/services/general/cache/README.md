# Cache da aplicação

## Fonte de verdade

O cache é uma otimização descartável. Ele nunca é fonte de verdade para:

- autenticação;
- autorização;
- assinatura;
- idade e consentimento;
- suspensão ou bloqueio;
- acesso a conteúdo privado.

Firestore/Functions permanecem autoritativos. NgRx representa estado compartilhado de domínio. Signals ou estado reativo local representam loading e demais estados de interface.

## Arquitetura

- `cache-contracts.ts`: definição tipada, envelope e resultado discriminado.
- `app-cache.service.ts`: fachada para fluxos novos e migrados.
- `cache-persistence.service.ts`: adaptador IndexedDB Observable-first.
- `cache-session-lifecycle.service.ts`: limpeza coordenada em logout e troca de UID.
- `cache-auth-lifecycle-bridge.service.ts`: integração reativa com `AuthSessionService.uid$`.
- `cache-legacy-migration.service.ts`: saneamentos idempotentes temporários.
- `legacy-cache-persistence-policy.ts`: barreira de privacidade para consumidores legados.

O `cache.service.ts` permanece somente como compatibilidade para consumidores ainda não migrados.

## Regras obrigatórias

1. Persistência é opt-in.
2. Dados `restricted` não podem usar storage persistente.
3. Cache user-scoped exige `ownerUid`.
4. TTL, stale window e versão ficam no mesmo envelope do valor.
5. `null` pode ser valor legítimo; ausência usa `status: 'miss'`.
6. Loading, modal, formulário e seleção visual não pertencem ao cache.
7. Falha do IndexedDB não deve gerar toast nem impedir o fluxo principal.
8. Chaves não devem conter e-mail, senha, token ou texto íntimo em claro.
9. Mutations de domínio devem invalidar ou atualizar explicitamente suas definições.
10. Toda política user-scoped precisa de teste de logout e troca de UID.
11. Perfil completo nunca deve ser espelhado em `localStorage`.
12. O adaptador legado não pode reidratar chaves bloqueadas pela política de privacidade.

## Escolha de camada

| Necessidade | Camada |
|---|---|
| Estado compartilhado e reativo | NgRx da feature |
| Estado local da tela | Signal / Observable local |
| Requisição ou listener em voo | `Map` + `shareReplay` no serviço de domínio |
| Dado público reutilizável | `AppCacheService`, preferencialmente memória |
| Persistência local aprovada | `AppCacheService` com `storage: 'persistent'` |
| Dado íntimo/restrito | memória ou NgRx; nunca IndexedDB por conveniência |

## Migração concluída nesta fase

- validação de apelido: cache público somente em memória;
- preferências íntimas: `user/restricted/memory`, com SWR tipado;
- limpeza de `preferences:*` legado;
- logout e hard sign-out integrados ao ciclo de vida do cache;
- troca de UID e sessão nula limpando escopos anteriores;
- loading de busca/configurações removido do cache;
- pesquisa de amigos: cache privado, viewer-scoped e somente em memória;
- configurações de amizade: Store da feature, sem cache e sem atraso artificial;
- `allUsers`: cache privado e somente em memória;
- perfil atual: objeto completo removido de `localStorage`;
- leituras/gravações legadas sensíveis bloqueadas no adaptador IndexedDB;
- resíduos sensíveis conhecidos saneados no bootstrap.

## Próximas migrações

1. `UserDiscoveryQueryService` para definições viewer-scoped do `AppCacheService`.
2. Catálogos públicos/IBGE com persistência tipada e versionada.
3. Serviços sociais restantes ainda ligados ao `CacheService`.
4. Remoção do slice genérico de cache no NgRx.
5. Remoção do `CacheSyncService` e do Firestore legado após busca final de consumidores.

## Arquivos ainda preservados

Os arquivos abaixo não devem ser apagados antes de migração, busca de imports, build e testes:

- `cache.actions.ts`;
- `cache.reducer.ts`;
- `cache.selectors.ts`;
- `cache.effects.ts`;
- `cache.state.ts`;
- `cache-sync.service.ts`;
- `data-handling/legacy/firestore.service.ts`.

Motivo previsto da supressão futura: responsabilidades duplicadas ou fluxo de uso inconsistente. Até essa etapa, não adicionar novos consumidores a esses arquivos.
