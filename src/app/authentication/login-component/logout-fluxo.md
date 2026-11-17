# Fluxo canônico de logout

A plataforma possui uma única fronteira de encerramento de sessão: `LogoutService`.

- UI pode delegar por `AuthFacade.logout$()`/`logoutNow()` ou diretamente ao `LogoutService` quando já estiver na camada global de shell/orquestração.
- Nenhuma feature (Comunidades, Salas, chat, perfil, descoberta, notificações etc.) deve importar ou chamar `signOut` do Firebase diretamente.
- `AuthSessionService` é a fonte canônica da sessão operacional. Ao iniciar logout, ele entra em estado `terminating` e deixa de expor UID/user operacional imediatamente, enquanto `Auth.currentUser` permanece disponível internamente apenas até os cleanups autenticados terminarem.
- O encerramento coordena geolocalização, Presence, Web Push, Firebase Auth, caches sensíveis, `CurrentUserStore` e navegação.
- NgRx e listeners user-scoped devem reagir à queda/troca do UID canônico; não devem implementar um segundo logout próprio.
- `PresenceService`/`PresenceOrchestratorService` são os donos atuais de presença. Não reintroduzir Realtime Database/onDisconnect ou Effects legados como autoridade de logout.
- `scripts/quality/check-auth-signout-boundary.mjs` protege a fronteira no Quality Gate e deve continuar falhando fechado se surgir `signOut` bruto fora de `logout.service.ts`.

O serviço consulta alterações pendentes na tela ativa antes de iniciar o logout. A confirmação autoriza descartar o rascunho após o encerramento confirmado pelo Firebase. Se o sign-out falhar com a mesma conta ainda ativa, a edição fica disponível e os orquestradores rearmam seus recursos. A recuperação do Web Push tem prazo de 3 segundos.

O shell oculta a tela protegida após o encerramento efetivo. Se a navegação para o login falhar ou for cancelada, o botão “Abrir login” permite tentar novamente. Quando a navegação termina, a tela de login confirma a saída voluntária.

[Política de autenticação](../../../../docs/dev/auth-session-policy.md) · [Checklist local](../../../../docs/dev/auth-validation-checklist.md)
