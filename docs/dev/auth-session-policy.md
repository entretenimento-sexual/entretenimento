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

- O Angular inicia a restauração com `provideAppInitializer` e aguarda a
  promessa de bootstrap pelo prazo definido em `FIREBASE_AUTH_RESTORE_TIMEOUT_MS`.
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

## Cadastro pendente e troca de conta

- A rota de idade permite apenas o acesso à etapa do cadastro para um perfil ativo, incompleto, privado e com login permitido. Suspensão, lock, exclusão pendente, restrição por reverificação etária, retenção de moderação e bloqueio técnico continuam impedindo esse caminho. O lifecycle das rotas de produto e a autorização do backend continuam independentes da exceção de navegação.
- O UID vem de `AuthSessionService`. Perfil, decisão etária, aceite, confirmação de documento ausente e navegação pós-login só afetam a conta que iniciou a operação. O orquestrador também invalida consultas do ciclo anterior quando o mesmo UID volta após sair.
- Após confirmação etária, `RegisterFlowFacade` define a próxima etapa. A página preserva o destino original para depois do cadastro e apresenta progresso, confirmação ou uma ação para tentar abrir a próxima tela novamente. O login aguarda a navegação antes de encerrar a operação.
- Quando o cadastro já criou a conta e a tela de verificação não abriu, a interface informa que a conta foi criada e orienta a entrar com o e-mail usado no cadastro.
- O indicador do cadastro apresenta conta, e-mail, termos, confirmação 18+ e perfil. Ele usa as etapas já autorizadas pelo fluxo e as confirmações das próprias páginas. A recuperação de conta e a renovação de termos são fluxos auxiliares. Preferências vêm depois do cadastro. O indicador não grava dados nem decide a autorização.
- A criação da conta apresenta apelido, dados de acesso e confirmações em telas sucessivas. Cada avanço valida os campos da tela atual. Voltar mantém o preenchimento em memória. O primeiro envio ao serviço de cadastro ocorre ao confirmar a última tela, depois da validação do formulário completo. O e-mail e a senha não são persistidos em rascunho local.

[Política de lifecycle](../../src/app/core/services/autentication/auth/account-lifecycle.policy.ts) · [Orquestrador](../../src/app/core/services/autentication/auth/auth-orchestrator.service.ts) · [Login](../../src/app/authentication/login-component/login-component.ts) · [Fluxo de logout](../../src/app/authentication/login-component/logout-fluxo.md) · [Cadastro](../../src/app/register-module/register.component.ts) · [Estado do cadastro](../../src/app/register-module/data-access/register-flow.facade.ts) · [Etapa de idade](../../src/app/compliance/age-verification-page/age-verification-page.component.ts)

## Perda de sessão e retorno ao login

- Em uma tela que exige autenticação, a perda do UID Firebase esconde o conteúdo e encaminha à tela de login. O destino interno é preservado. Quando a causa é desconhecida, o login informa “Sua sessão foi encerrada. Entre novamente para continuar.”
- Uma verificação de credencial pode concluir após o próprio SDK limpar o usuário. O motivo conhecido é registrado para o UID que iniciou a verificação e pode atualizar o login que já abriu. O marcador local contém apenas o motivo associado ao UID. Outras abas só o aplicam à conta ativa ou à conta que acabaram de perder.
- Login bem-sucedido por senha ou Google limpa o marcador do UID autenticado. Uma falha de rede isolada preserva a sessão. Encerramento voluntário segue o fluxo do `LogoutService`.
- Se o e-mail inicial falhar após a criação da conta, a tela de verificação oferece “Reenviar e-mail”. Se a sessão acabar durante o cadastro, a ação “Entrar novamente” retoma a conta existente e sua próxima etapa.

## Espera e recuperação da sessão

- A revalidação inicial pode esperar pelo Firebase por até 8 segundos antes de liberar a abertura da aplicação. A restauração tardia continua sendo observada e um resultado que pertence à sessão anterior é descartado. Um marcador de credencial inválida só é limpo por revalidação bem-sucedida da mesma sessão ou pelo login autorizado.
- Os guards de sessão e carregamento inicial de perfil exibem o login com o aviso de indisponibilidade e a ação “Tentar novamente” após 8 segundos de espera na navegação. A ação abre novamente a URL intermediária ou protegida que estava sendo solicitada e reinicia a conexão. O acesso protegido requer uma sessão confirmada e o perfil exigido pela rota.
- A conferência no cadastro diferencia falha de comunicação de e-mail efetivamente pendente. “Checar agora” permite repetir a consulta com a mesma conta e “Reenviar e-mail” continua disponível.
- O orquestrador mantém a observação da sessão ativa após falha em um contexto e processa as mudanças seguintes de conta e rota.

## Saída voluntária e rascunhos

- A saída voluntária confirma o descarte de alterações pendentes antes de iniciar a operação. Cancelar mantém a edição e a sessão. Depois de confirmar, o rascunho só é descartado se a credencial tiver sido encerrada.
- A tela protegida fica oculta depois de confirmar a saída no Firebase. Se o login não abrir, a interface informa que a sessão foi encerrada e oferece “Abrir login”. O login confirma a saída voluntária com “Você saiu da sua conta.”
- Se a credencial continuar ativa após uma falha de saída, a plataforma restaura o uso da sessão. A tentativa de recuperar o Web Push é limitada a 3 segundos. O logout coordena a parada de presença durante a saída voluntária.
- Após perda involuntária, os formulários com rascunho local salvam os campos pendentes antes de sair para o login. O arquivo de imagem selecionado segue em memória até a página fechar.

## Retomada de cadastro interrompido

- Enquanto a criação no Auth estiver em andamento no navegador, o cadastro impede outra tentativa concorrente. Em resposta incerta ou caso o e-mail não permita nova criação, o formulário público orienta entrar ou recuperar o acesso com mensagem neutra.
- Após criação confirmada, a reserva idempotente de apelido pode ser repetida uma vez em falha temporária. Se a reserva permanecer sem confirmação ou o apelido estiver em uso, a conta permanece disponível, com a etapa de verificação e reenvio. O servidor decide o apelido disponível na conclusão do perfil.
- O cadastro social recupera o seed privado pela transação já usada na retomada. A trigger e a recuperação preservam os dados do perfil que já existe. O servidor compara o UID da credencial com o UID esperado enviado pelos clientes atualizados nas operações de reserva, recuperação e aceite.
- O e-mail da conta é obtido da sessão na tela de verificação. O endereço da tela carrega somente o estado de envio.

## Confirmação pelo link de e-mail

- O Firebase confirma o e-mail associado ao código. A sessão só é atualizada se ainda corresponder à conta que iniciou a operação e ao destinatário do link.
- Um link válido pode ser confirmado sem login ou em um navegador com outra conta aberta. A tela orienta entrar com a conta que recebeu o link. A troca de conta usa a saída voluntária quando acionada.
- Falhas antes da confirmação permitem conferir o link novamente. Se o Firebase confirmar e a atualização do perfil ficar pendente, a tela informa o estado e oferece continuar na mesma conta. Um link inválido ou já usado encaminha para a conferência na conta correspondente.
