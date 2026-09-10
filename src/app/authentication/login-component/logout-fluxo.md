# Fluxo canônico de logout

A plataforma possui uma única fronteira de encerramento de sessão: `LogoutService`.

- UI pode delegar por `AuthFacade.logout$()`/`logoutNow()` ou diretamente ao `LogoutService` quando já estiver na camada global de shell/orquestração.
- Nenhuma feature (Comunidades, Salas, chat, perfil, descoberta, notificações etc.) deve importar ou chamar `signOut` do Firebase diretamente.
- `AuthSessionService` é a fonte canônica da sessão operacional. Ao iniciar logout, ele entra em estado `terminating` e deixa de expor UID/user operacional imediatamente, enquanto `Auth.currentUser` permanece disponível internamente apenas até os cleanups autenticados terminarem.
- O encerramento coordena geolocalização, Presence, Web Push, Firebase Auth, caches sensíveis, `CurrentUserStore` e navegação.
- NgRx e listeners user-scoped devem reagir à queda/troca do UID canônico; não devem implementar um segundo logout próprio.
- `PresenceService`/`PresenceOrchestratorService` são os donos atuais de presença. Não reintroduzir Realtime Database/onDisconnect ou Effects legados como autoridade de logout.
- `scripts/quality/check-auth-signout-boundary.mjs` protege a fronteira no Quality Gate e deve continuar falhando fechado se surgir `signOut` bruto fora de `logout.service.ts`.

Em falha do `signOut` voluntário, a sessão operacional é restaurada a partir do mesmo Firebase user ainda válido e os orquestradores rearmam seus recursos. Hard signout, ao contrário, permanece fail-closed se o Firebase continuar tecnicamente autenticado após a tentativa de encerramento.
