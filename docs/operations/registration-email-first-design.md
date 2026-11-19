# Cadastro por e-mail primeiro — contrato canônico de implementação
**Ambiente:** desenvolvimento e emuladores. **Estado:** desenho aprovado para implementação progressiva; não é autorização de deploy de produção.

## Etapas e apresentação
1. Apelido principal exclusivo (4–12), complemento opcional (até 12). Manter o formulário e consultar somente o principal. A reserva transacional usa `public_index/nickname:<principal>`; sem coleção duplicada.
2. Digitação de e-mail: campo único, aviso breve de privacidade e ação para solicitar link. Sem senha nessa tela após o cutover. Respostas de solicitação não podem revelar se o e-mail já pertence a uma conta.
3. Link único recebido: aplicar o fluxo Firebase de email-link sign-in; não tratar como simples `sendEmailVerification` de uma conta com senha. Na prévia local, o Functions Emulator cruza o código pendente com o Auth Emulator e resolve o destinatário, inclusive em outra aba ou navegador. A URL e o formulário de retorno dispensam o endereço. Link inválido/usado/expirado: feedback próprio + reenvio com limites.
4. Depois de autenticar por link, exibir a definição e confirmação de senha. A senha deve ser criada pelo mecanismo do Firebase Auth e jamais persistida em Firestore, telemetria ou storage. Não publicar o perfil nesta fase.
5. Após os Termos vigentes, reconciliar a evidência 18+ coletada na abertura do link e aplicar a decisão etária canônica.
6. Conclusão de perfil, manutenção do UID esperado, transação protegida e liberação somente depois da decisão backend.

## Retomada e liberação de acesso

| Marco | Como retomar | Acesso |
|---|---|---|
| Apelido ou e-mail digitados | Reabrir o cadastro na mesma aba. O rascunho local expira 30 minutos após a última gravação. Sem rascunho, link válido ou conta vinculada, preencher novamente os dados iniciais. | Cadastro inicial. |
| Link solicitado | Abrir o link recebido. Ao recarregar a aba que solicitou o envio, a tela volta para **Confira seu e-mail** enquanto o rascunho existe. Se o link não estiver disponível, usar **Retomar cadastro → Receber novo link** com o mesmo e-mail. | Cadastro inicial. |
| E-mail confirmado, senha pendente | A sessão aberta pelo link permite criar a senha. Em outra aba que compartilha a mesma sessão, **Continuar cadastro** abre a etapa pendente. Sem sessão, solicitar um novo link com o mesmo e-mail. O backend pode reutilizar a conta e o apelido já vinculados. | Cadastro e ações de suporte. |
| Senha definida, Termos pendentes | Na tela de cadastro, usar **Retomar cadastro** e entrar com o mesmo e-mail e senha. A plataforma reabre os Termos. Marcar a caixa sem enviar o formulário deixa o aceite pendente. | Sessão autenticada para concluir o cadastro. Perfil privado e interações bloqueadas enquanto a conta estiver incompleta. |
| Termos aceitos, cadastro pendente | Entrar com a mesma conta para abrir a primeira pendência após o aceite, como confirmação 18+ quando necessária ou Perfil. Vale o aceite registrado pelo backend, inclusive se a aba foi fechada antes de mostrar a próxima etapa. | Sessão autenticada para concluir o cadastro. |
| Termos vigentes aceitos, elegibilidade 18+ confirmada e perfil concluído | O backend grava a conclusão do perfil e a sessão já aberta pode seguir. Preferências podem ser ajustadas depois. | Recursos da plataforma conforme o estado da conta e as permissões de cada recurso. |

Na prévia, quando a sessão da mesma conta é reconhecida na aba que solicitou o link, **E-mail confirmado** substitui a tela de espera. A pessoa escolhe em qual aba continuar. Se houver outra conta conectada, a página oferece retomar a sessão ativa, sem atribuir a ela a confirmação do e-mail solicitado. Em outro navegador, dispositivo ou origem local (por exemplo, alternando `localhost` e `127.0.0.1`), a sessão é independente. Continue onde o link foi aberto ou use **Entrar** depois de definir a senha.

Se a senha ficou pronta antes da reserva do apelido, a conclusão de Perfil preenche o apelido do registro privado vinculado ao UID como sugestão editável. O apelido já reservado é reutilizado automaticamente. Se o rascunho anterior à confirmação do e-mail expirou e nenhum apelido foi vinculado, a etapa de Perfil pede esse dado.

`loginAllowed: true` é um dos sinais usados para decidir se a conta pode entrar. A conclusão do cadastro é marcada por `profileCompleted: true` e `registrationCompletedAt`. A presença em Authentication ou a reserva do apelido no índice podem ocorrer antes disso.

Ao abrir diretamente uma rota como Explorar enquanto `interactionBlocked` está ativo, o guard pode encaminhar para o status da conta. Para retomar a primeira etapa pendente, use a página de entrada ou **Continuar cadastro** na aba que solicitou o link.

## Simulação de limpeza de rascunhos

Com o Firestore Emulator ativo, execute na raiz do repositório.

```sh
node scripts/maintenance/audit-registration-draft-cleanup-emulator.mjs --dry-run
```

O relatório reúne contagens de rascunhos temporários vencidos (`expiredDrafts`), válidos (`validDrafts`), recibos de contas (`accountReceipts`) e registros que ficaram fora da classificação (`unclassified`). Ele usa `expiresAtMs` com uma referência de horário fixa. A consulta é somente leitura e o resultado contém só contagens e metadados da execução. Recibos por UID preservam os dados já vinculados ao cadastro.

Por padrão, o comando usa o projeto local `entretenimento-sexual` no endereço `127.0.0.1:8080`. Para um emulador isolado, informe `FIRESTORE_EMULATOR_HOST` e `FIREBASE_PROJECT_ID` antes de executar. O prazo de retenção de contas incompletas segue como uma decisão separada.

## Risco documentado pelo Firebase — contas já existentes

O Firebase Auth informa que a autenticação por link pode **invalidar sessões anteriores e remover a senha de uma conta criada com e-mail/senha ainda não verificada**, no momento em que o link é consumido. Isso não pode ser introduzido silenciosamente em um cadastro existente. Fonte: https://firebase.google.com/docs/auth/web/email-link-auth

A ativação do novo provedor dependerá de um teste reproduzível em Auth Emulator com contas antigas (e-mail verificado/não verificado), link usado em outra sessão, criação de senha após o link, e um bloqueio inequívoco contra entrada em perfil de outra conta. Não usar `sendEmailVerification` como substituto de `sendSignInLinkToEmail`. Enquanto o teste não passar, manter **desativada** a nova jornada de autenticação.

As duas cenas fotográficas WebP foram integradas à `main` no commit `4f3922c7`. Não depender de imagens externas, instaladores locais ou artefatos não versionados.

## Dependências de segurança obrigatórias antes da virada
- **Autoridade etária:** o fluxo atual exige declaração 18+ antes de criar o UID. Como `signInWithEmailLink` cria/autentica a conta no primeiro clique, preservar a declaração pré-Auth na própria confirmação do link, imediatamente antes de consumi-lo; não presumir maioridade com base em e-mail confirmado. O backend conserva a confirmação pré-Auth com UID, data e versão. Depois dos Termos, a evidência vigente alimenta a reconciliação canônica sem repetir a pergunta. Um cadastro antigo sem evidência aproveitável passa pela etapa 18+.
- **Estado canônico:** introduzir `passwordSetup` como etapa do `RegisterFlowFacade` / `RegisterNavigationService` somente com evidência de criação de credencial; conta recém-autenticada por link sem senha não pode pular para Termos, Perfil ou Preferências. Estado protegido pelo backend, vinculado ao UID e resistente a troca de sessão.
- **Autenticação:** conferir os provedores e a sessão no Firebase Auth. `updatePassword` exige autenticação recente; após perder a sessão, reautenticar por link. Não inferir senha definida de uma flag controlada pelo navegador. A transição de provedor não pode resetar credenciais de uma conta existente.
- **Reserva:** apelido pesquisado é indicação provisória; entre entrada de e-mail e clique no link outra conta pode reservá-lo. Após login por link, reservar no `public_index` e retornar ao apelido em caso de disputa, sem criar perfil indevido.
- **Navegação:** guards para todas as rotas internas e chamadas críticas recusam conta incompleta. Permitir apenas continuar, suporte, reenviar, trocar e-mail e sair. Logout invalida estados temporários do UID antigo.
- **Privacidade:** nenhum e-mail ou token nos parâmetros de auditoria e logs. Rascunho da etapa pode ser associado a nonce local efêmero; não guardar senha, orientação ou município em storage persistente.
- **Custo/abuso:** debounce só do apelido principal; limitar envio e reenvio de links por origem e identidade quando aplicável; tratar erro e timeout de forma neutra; não anunciar envio de e-mail se a operação não foi confirmada.
- **Emuladores e produção:** habilitar Email Link em Authentication > Sign-in method no projeto de desenvolvimento apropriado, confirmar domínios autorizados. Não habilitar App Check/Fraud Defense de produção por essa mudança. Manter antigo fluxo funcional até a suíte E2E end-to-end ficar verde.

## Feedback canônico
| Estado | Feedback | Ação |
|---|---|---|
| E-mail inválido | Confira o endereço informado. | Corrigir campo |
| Pedido de envio aceito | Procure o link na caixa de entrada ou no spam. | Verificar e-mail, corrigir o endereço ou aguardar o contador para reenviar |
| Envio inconclusivo por rede | Envio sem confirmação. Confira a caixa de entrada e o spam. | Verificar e-mail ou reenviar quando o botão voltar a ficar disponível |
| Sem conexão antes do envio | Aguarde a conexão voltar para enviar o link. | Retomar com o endereço preenchido |
| Link inválido/expirado | Este link não pode mais ser usado. | Pedir outro |
| Link de outra conta | Esta confirmação pertence a outra sessão. | Trocar conta com segurança |
| E-mail confirmado | Endereço confirmado. Agora defina sua senha. | Criar senha |
| Senha não concluída | Sua senha ainda não foi confirmada. | Reautenticar se necessário |
| Termos/idade/perfil pendentes | Seu cadastro ainda não foi concluído. | Continuar etapa |
| Cadastro concluído | Seu perfil está pronto. | Entrar na plataforma |

## Layout e cenas
- As três cenas WebP usam `object-fit: contain` e tamanho do elemento alinhado à proporção intrínseca da imagem em janelas horizontais. A primeira cena dissolve sua borda direita suavemente; a segunda (e-mail) e a terceira (declarações) usam uma máscara própria com início mais à direita para proteger a composição com mais personagens. Todas compartilham fundo escuro radial e mostram o formulário à direita. Em janelas estreitas ou altas, a composição passa a uma coluna, com a foto acima e o formulário centralizado logo abaixo. Na tela de apelido, a foto ocupa a largura da janela e mantém os rostos enquadrados pelo topo. O documento rola quando o conteúdo precisa de mais altura.
- A confirmação do link e a criação de senha usam fotografia WebP que preenche a área entre a navbar e o fim do rodapé. A versão vertical preserva o enquadramento em retrato e o formulário permanece em primeiro plano.
- Termos mantém a paleta escura e a tipografia do cadastro, com uma fotografia própria no desktop. Os links de leitura abrem os documentos públicos em uma nova aba, preservando o formulário de aceite na aba de origem. A leitura permanece disponível para contas com cadastro pendente ou bloqueio. Criação de senha e confirmação têm controles de visibilidade independentes.
- Fade de ~380 ms; respeitar `prefers-reduced-motion`, sem vídeos, animações contínuas ou nova biblioteca. Imagem decorativa com `alt=""` e `aria-hidden`.
- Padronizar a largura do card e manter as instruções curtas, com erros não modais, visíveis quando for necessária ação e anunciados por leitores de tela.

## Critérios para autorizar substituição do fluxo existente
1. E2E com Auth/Firestore/Functions Emulator, criação por link em mesmo e outro navegador.
2. Comprovar 18+ pré-Auth, senha após link e bloqueio de navegação/autorização no backend enquanto incompleto.
3. Casos de link expirado, duplicado, e-mail já existente, falta de conexão, timeout, usuário lento, troca de sessão, logout e disputa pelo apelido.
4. Verificar feedback e invariância visual em desktop/móvel, inclusive `prefers-reduced-motion`.
5. Nenhum deploy de produção; revisar custo e configuração do provedor antes de qualquer habilitação remota.


## Fase técnica A — preparação da autenticação por link (sem cutover)

- Criado `EmailLinkRegistrationService` com APIs RxJS para solicitar link, consumi-lo após declaração 18+ e definir senha para UID esperado, com tratamento de erro centralizado e nenhuma gravação de segredo.
- A fase técnica A limitou o serviço ao emulador e à flag `emailFirstSignupPreview`. O `RegisterService` era a única entrada de cadastro nessa fase.
- A confirmação do link usa a API `signInWithEmailLink` (não `applyActionCode`) e compara UID e e-mail resultantes com a sessão corrente.
- A interface depende da autoridade backend de `passwordSetup`, da proteção de contas preexistentes e dos testes com links usados, sessão trocada e retorno em outro dispositivo.

## Fase técnica B — prévia na interface emulada

- Em `dev-emu`, **Continuar** na etapa de apelido abre a etapa de e-mail no mesmo formulário. A ação **Enviar link** solicita a confirmação e apresenta a tela **Confira seu e-mail**. Em testes locais, copie o link do log do Auth Emulator. A página faz uma consulta de leitura ao Auth Emulator ao abrir o link. Um link válido para cadastro abre a etapa 18+, antes de Senha e Termos. Se o endereço já possui conta, oferece entrada pelo método de acesso já cadastrado. Um link indisponível ou com rascunho expirado oferece um novo envio.
- No emulador, `prepareEmailLinkRegistration` confirma o código e resolve o destinatário no Auth local, devolvendo o endereço ao portador do link válido para o consumo pelo Firebase Auth. O callable reserva um UID por meio da unicidade do Firebase Auth. Antes do consumo nativo, recusa contas fora da prévia e contas cuja senha já foi configurada. A resposta de envio permanece genérica.
- `passwordSetup` consulta a credencial no Auth Emulator e limita a definição de senha à sessão e ao UID esperados. As operações de Termos, maioridade, reserva de apelido e perfil conferem a credencial no backend. A tela consulta o que foi salvo antes de repetir uma gravação de senha que ficou sem confirmação.
- Antes do envio, o apelido fica em um rascunho privado do emulador. O link leva uma referência opaca e o backend a valida contra o destinatário do código antes de transferir o apelido ao UID. Após a senha, a reserva atualiza o índice, o documento privado e o nome de exibição no Auth. Se houver disputa pelo apelido ou se um link antigo não tiver rascunho recuperável, o usuário pode concluir essa escolha em Perfil.
- Em Perfil, a identificação usa o catálogo de perfil vigente. A orientação sexual é opcional, e o formulário informa que a escolha aparece no perfil. O e-mail fica no cadastro privado.
- Os callables desta fase são exportados somente no Functions Emulator. A reserva baseada na verificação local de códigos é específica da prévia. A arquitetura para habilitação remota e os critérios de virada continuam pendentes.
