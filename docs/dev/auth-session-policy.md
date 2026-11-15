# Politica canonica de autenticacao e sessao

Status: B3.2C.22E - politica aprovada; implementacao e QA completos ainda pendentes.

## Regras obrigatorias

1. Uma unica identidade autenticada por perfil de navegador e origem.
2. Abas da mesma origem compartilham a identidade do Firebase Auth.
3. Fechar aba, atualizar pagina, fechar navegador ou reiniciar computador nao e motivo para logout.
4. A persistencia padrao e browserLocalPersistence.
5. A opcao "Lembrar de mim" nao controla mais a duracao da sessao e deve ser retirada da interface.
6. Senhas nunca sao armazenadas manualmente em localStorage, sessionStorage ou Firestore.
7. A troca de conta deve ser explicita e deve limpar o estado sensivel da conta anterior.
8. O logout voluntario deve encerrar a sessao em todas as abas da mesma origem.
9. Falhas transitorias de rede, refresh e reinicializacao nao autorizam logout automatico.
10. Conta bloqueada, credencial revogada ou identidade tecnicamente invalida nao podem continuar acessando recursos protegidos.
11. Quando a recuperacao exigir nova autenticacao, a interface deve explicar o motivo.
12. Emuladores podem manter override explicito de memoria para testes isolados; esse modo nao define a politica de producao.

## Responsabilidades dos arquivos

- src/app/core/services/autentication/auth-session-persistence.service.ts: politica unica de persistencia.
- src/app/core/firebase/firebase.providers.ts: inicializacao do Firebase Auth.
- src/app/core/firebase/firebase-environment.config.ts: configuracao especifica do ambiente.
- src/app/core/firebase/firebase-auth-session.initializer.ts: restauracao da sessao; nao apagar sessoes validas por falhas transitorias.
- src/app/core/services/autentication/login.service.ts: login por senha.
- src/app/core/services/autentication/social-auth.service.ts: login social.
- src/app/core/services/autentication/auth/auth-session.service.ts: fonte reativa canonica de UID e estado operacional.
- src/app/core/services/autentication/auth/auth-orchestrator.service.ts: watchers, bloqueios de dominio e ciclo de vida.
- src/app/core/services/autentication/auth/auth-session-monitor.service.ts: verificacao tecnica; nao confundir falha transitoria com invalidacao definitiva.
- src/app/core/services/autentication/auth/logout.service.ts: fronteira unica para signOut, limpeza e logout voluntario.
- src/app/core/services/autentication/auth/auth-app-block.service.ts: bloqueio de acesso sem obrigatoriamente encerrar o Firebase Auth.
- src/app/authentication/login-component/login-component.html: interface de login.
- src/app/authentication/login-component/logout-fluxo.md: detalhes do fluxo de logout.

## Distincoes essenciais

Persistencia nao equivale a validade eterna de credenciais. A sessao
permanece enquanto o navegador preservar o armazenamento e o Firebase
aceitar a identidade. Revogacao, exclusao, bloqueio e expiracao tecnica
devem ser tratados sem permitir acesso indevido.

Bloquear recursos protegidos nao e equivalente a chamar signOut.
Quando uma credencial se tornar definitivamente inutilizavel, pode
ser necessario solicitar nova autenticacao com feedback explicito.

Uma origem e definida por protocolo, host e porta. Portanto,
localhost:4200 e 127.0.0.1:4200 nao compartilham obrigatoriamente
a mesma persistencia. Perfis diferentes do Chrome sao independentes.

O gerenciador de senhas do Chrome e separado da sessao Firebase.

## Diretrizes de implementacao

- Preservar os nomes publicos dos metodos sempre que possivel.
- Priorizar Observable e reatividade via RxJS.
- Manter acessibilidade dos fluxos de autenticacao e recuperacao.
- Centralizar tratamento de erros nos servicos existentes, incluindo
  global-error-handler.service.ts, error-notification.service.ts e
  ApplicationErrorService.
- Nao introduzir BroadcastChannel ou mecanismo paralelo sem comprovada necessidade.
- Limpar estado NgRx, caches e listeners vinculados ao UID anterior em trocas reais de identidade.
- Nao alterar dados dos emuladores nem criar custo de producao durante QA.

## Validacoes obrigatorias

- Login por senha e Google preservam a mesma politica.
- Nova aba reconhece a mesma conta.
- Logout voluntario propaga sem refresh.
- Refresh preserva a sessao.
- Fechamento e reabertura do navegador preservam a sessao valida.
- Falha transitoria de rede nao desloga.
- Bloqueio de dominio impede acesso protegido com mensagem adequada.
- Troca de identidade limpa dados da conta anterior.
- Testes unitarios de persistencia, inicializacao, login, monitor e logout passam.
- Compilacao Angular e Quality Gate passam.

## Pendencias B3.2C.22E

- Concluir a revisao dos encerramentos involuntarios.
- Validar persistencia apos reinicio completo do navegador.
- Validar isolamento de contas e troca explicita de identidade.
- Executar testes de regressao e build.
- Tratar Web Push 404 em etapa separada.
- Investigar getPendingFriendRequests HTTP 429 em etapa separada.

Nao marcar esta etapa como homologada antes dessas verificacoes.

## B3.2C.22F - Monitor tecnico

O AuthSessionMonitorService nao executa logout automatico
ao identificar credencial definitivamente invalida.

- Falha transitoria: diagnostico, sem logout.
- Credencial invalida: AuthAppBlockService com auth-invalid.
- Feedback: ApplicationErrorService.
- Logout voluntario: responsabilidade de LogoutService.

Pendentes: restauracao inicial, persistencia do bloqueio apos
refresh e revisao dos caminhos alternativos do orquestrador.


## B3.2C.22F - Orquestrador

O AuthOrchestratorService utiliza blockAppSession em casos
confirmados de documento ausente, exclusao e acesso proibido.

Nao existe mais alternativa configuravel de hard logout
para esses eventos.

O bloqueio do bootstrap permanece no primeiro reconhecimento
do UID. A troca real de identidade limpa o bloqueio anterior.

Pendente: revisar a restauracao inicial do Firebase e
validar que um bloqueio de seguranca nao seja contornado
por refresh.


## B3.2C.22F - Restauracao Firebase e bloqueio persistente

- A restauracao revalida currentUser.reload() tanto no Cloud quanto no emulador.
- Uma credencial confirmadamente invalida bloqueia o app via AuthAppBlockService,
  sem executar signOut automatico.
- O bloqueio auth-invalid recebe um marcador local por UID, sem senha nem token.
- Um refresh com falha transitoria de rede nao apaga esse marcador.
- A revalidacao bem-sucedida da mesma identidade remove o marcador e o
  bloqueio auth-invalid. Erros transitorios nao causam logout.
- O modo QA memory bloqueia uma identidade restaurada indevidamente, sem signOut.
- Validar em QA a resposta visual ao bloqueio, reautenticacao e sincronizacao
  entre abas. O backend continua responsavel pela autorizacao efetiva.
