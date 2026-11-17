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

O shell oculta a tela protegida assim que a saída é confirmada pelo usuário e exibe “Encerrando sessão…”. Após 10 segundos de espera, informa que a saída ainda não pôde ser confirmada e permite recarregar a página para verificar a sessão. A espera da interface preserva a operação do Firebase. Uma confirmação tardia conclui a saída normalmente.

Uma falha com a mesma sessão ativa reabre a tela e oferece “Tentar sair novamente”. Se o SDK rejeitar a operação após limpar o usuário em memória, o shell mantém a tela protegida e oferece recarga para verificar a sessão persistida.

Depois de confirmado o encerramento pelo Firebase, o shell abre a tela de login. Se a navegação falhar ou for cancelada, o botão “Abrir login” permite tentar novamente. A tela de login confirma a saída voluntária.

[Política de autenticação](../../../../docs/dev/auth-session-policy.md) · [Checklist local](../../../../docs/dev/auth-validation-checklist.md)
