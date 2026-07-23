# Cache da aplicação

## Fonte de verdade

O cache é uma otimização descartável. Ele nunca é fonte de verdade para:

- autenticação;
- autorização;
- assinatura;
- idade e consentimento;
- suspensão ou bloqueio;
- acesso a conteúdo privado.

Firestore/Functions permanecem autoritativos. NgRx representa estado compartilhado de domínio. Signals ou estado da feature representam loading e demais estados de interface.

## Arquitetura nova

- `cache-contracts.ts`: contratos tipados, envelope e resultado discriminado.
- `app-cache.service.ts`: fachada usada por novos fluxos.
- `cache-persistence.service.ts`: adaptador IndexedDB sem regras de domínio.

O `cache.service.ts` permanece temporariamente como compatibilidade para consumidores ainda não migrados.

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
10. Toda nova política de persistência precisa de teste de logout/troca de UID.

## Escolha de camada

| Necessidade | Camada |
|---|---|
| Estado compartilhado e reativo | NgRx da feature |
| Estado local da tela | Signal / Observable local |
| Requisição ou listener em voo | `Map` + `shareReplay` no serviço de domínio |
| Dado público reutilizável | `AppCacheService`, preferencialmente memória |
| Persistência local aprovada | `AppCacheService` com `storage: 'persistent'` |
| Dado íntimo/restrito | memória ou NgRx; nunca IndexedDB por conveniência |

## Migração planejada

1. Validações efêmeras.
2. Catálogos públicos e IBGE.
3. Descoberta pública com chave viewer-scoped.
4. Preferências como cache restrito somente em memória.
5. Perfil do usuário atual sem objeto completo no `localStorage`.
6. Amizades e pesquisas sem persistência automática.
7. Remoção do slice genérico de cache no NgRx.
8. Remoção do `CacheSyncService` e do Firestore legado após busca final de consumidores.

## Supressões futuras

Os arquivos abaixo não devem ser apagados antes de migração, busca de imports, build e testes:

- `cache.actions.ts`;
- `cache.reducer.ts`;
- `cache.selectors.ts`;
- `cache.effects.ts`;
- `cache.state.ts`;
- `cache-sync.service.ts`;
- `data-handling/legacy/firestore.service.ts`.

Motivo previsto da supressão: responsabilidades duplicadas ou fluxo de uso inconsistente. Até essa etapa, não adicionar novos consumidores a esses arquivos.
