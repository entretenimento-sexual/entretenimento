# Cadastro por e-mail primeiro — contrato canônico de implementação
**Ambiente:** desenvolvimento e emuladores. **Estado:** desenho aprovado para implementação progressiva; não é autorização de deploy de produção.

## Etapas e apresentação
1. **E-mail.** Campo único, aviso de privacidade e ação **Continuar com e-mail**. Quem já definiu uma senha pode usar **Entrar** para retomar. A resposta ao pedido de envio é neutra sobre a existência da conta.
2. **Maioridade.** No retorno do link, coletar a declaração antes de consumir o código e criar a conta. O Functions Emulator resolve o destinatário pelo código pendente no Auth Emulator. Conta existente com senha segue para o login. Link indisponível oferece novo envio.
3. **Senha.** Após a autenticação por link, definir a senha no Firebase Auth. Senha fica fora de Firestore, telemetria e storage.
4. **Termos.** Após o aceite, reconciliar a evidência 18+ da abertura do link e aplicar a decisão etária canônica.
5. **Perfil.** Quem ainda não tem apelido escolhe o principal (4–12) e pode acrescentar um complemento (até 12). A mesma transação valida o UID, reserva `public_index/nickname:<principal>`, grava o perfil e libera o acesso. O apelido reservado antes desta mudança continua associado à conta.

O formulário revela a identificação após o apelido válido ou reservado. A orientação permanece opcional. Depois de escolher a identificação, a pessoa escolhe o estado e seleciona o município na lista carregada para aquele estado. Com os campos obrigatórios preenchidos, ela pode adicionar uma foto ou concluir o cadastro diretamente. Ao retomar, os campos já recuperados revelam a próxima pendência. Orientação, município e foto ainda sem envio precisam ser informados novamente.

## Retomada e liberação de acesso

| Marco | Como retomar | Acesso |
|---|---|---|
| E-mail digitado | Reabrir o cadastro na mesma aba. O rascunho local expira 30 minutos após a última gravação. Ao expirar, basta informar o e-mail novamente. | Cadastro inicial. |
| Link solicitado | Abrir o link recebido. Ao recarregar a aba que solicitou o envio, a tela volta para **Confira seu e-mail** enquanto o rascunho existe. Se o link não estiver disponível, reenviar para o mesmo e-mail. Recarregar a aba durante ou depois do envio conserva o prazo original de 30 segundos para reenviar. | Cadastro inicial. |
| E-mail confirmado, senha pendente | A sessão aberta pelo link permite criar a senha. Em outra aba que compartilha a mesma sessão, **Continuar cadastro** abre a etapa pendente. Sem sessão, solicitar um novo link com o mesmo e-mail. O backend pode reutilizar a conta e o apelido já vinculados. | Cadastro e ações de suporte. |
| Senha definida, Termos pendentes | Na tela de cadastro, usar **Entrar** com o mesmo e-mail e senha. A plataforma reabre os Termos. Marcar a caixa sem enviar o formulário deixa o aceite pendente. | Sessão autenticada para concluir o cadastro. Perfil privado e interações bloqueadas enquanto a conta estiver incompleta. |
| Termos aceitos, cadastro pendente | Entrar com a mesma conta para abrir a primeira pendência após o aceite, como confirmação 18+ quando necessária ou Perfil. Vale o aceite registrado pelo backend, inclusive se a aba foi fechada antes de mostrar a próxima etapa. | Sessão autenticada para concluir o cadastro. |
| Termos vigentes aceitos, elegibilidade 18+ confirmada e perfil concluído | O backend grava a conclusão do perfil e a sessão já aberta pode seguir. Sem destino interno explícito, a conclusão abre `/preferencias/editar` tanto no fluxo contínuo quanto na retomada. | Recursos da plataforma conforme o estado da conta e as permissões de cada recurso. |

Na prévia, quando a sessão da mesma conta é reconhecida na aba que solicitou o link, **E-mail confirmado** substitui a tela de espera. A pessoa escolhe em qual aba continuar. Se houver outra conta conectada, a página oferece retomar a sessão ativa, sem atribuir a ela a confirmação do e-mail solicitado. Em outro navegador, dispositivo ou origem local (por exemplo, alternando `localhost` e `127.0.0.1`), a sessão é independente. Continue onde o link foi aberto ou use **Entrar** depois de definir a senha.

Se um link antigo já vinculou um apelido ao UID, o perfil pode apresentar esse valor como sugestão editável enquanto ainda não houver reserva. O apelido já reservado é reutilizado automaticamente.

Solicitar outro link para um e-mail que já tem senha leva à entrada da conta existente. Depois da autenticação, a plataforma abre a primeira etapa pendente. A tela de Termos identifica o cadastro pelo apelido salvo, quando disponível.

`loginAllowed: true` é um dos sinais usados para decidir se a conta pode entrar. A conclusão do cadastro é marcada por `profileCompleted: true` e `registrationCompletedAt`. A presença em Authentication ou a reserva do apelido no índice podem ocorrer antes disso.

Enquanto o perfil estiver incompleto, ativo e privado por padrão, a abertura direta de uma rota protegida encaminha à primeira etapa pendente, preservando o destino interno válido. Suspensão, restrição etária ou de moderação, exclusão em curso e bloqueios independentes têm precedência e abrem o status da conta. Termos e documentos públicos seguem disponíveis.

## Retenção proposta e simulação de abandono

Os prazos abaixo são limites de inatividade para triagem. Recontam a partir da atividade válida mais recente. Expiração de link e inatividade da conta são relógios independentes.

Fechar o navegador não inicia uma exclusão. O `dev-emu` permite simular a classificação abaixo com Auth e Firestore locais. O script não aceita destinos remotos. O build `development` padrão usa a configuração Firebase remota, e `staging` aponta para `entretenimento-staging`. O repositório não ativa uma rotina de exclusão por abandono nesses ambientes. A passagem do prazo classifica candidatos, sem apagar dados.

| Estado | Janela | Resultado da triagem |
|---|---|---|
| E-mail ainda no formulário | 30 minutos | Expiração do rascunho da aba |
| Link com rascunho pré-Auth | 30 minutos | Identificar o rascunho vencido, preservando recibos por UID |
| Conta criada e e-mail pendente | 7 dias | Candidata após o prazo. Um novo pedido de link permite retomar durante a janela |
| E-mail confirmado na prévia e senha pendente | 7 dias | Candidata após o prazo. A sessão ou novo link válido permite retomar |
| E-mail confirmado e Termos pendentes | 30 dias | Candidata após o prazo. Entrada com a credencial da conta retoma os Termos |
| Termos aceitos e maioridade ou perfil pendentes | 90 dias | Candidata após o prazo. A primeira etapa pendente abre ao entrar |
| Revisão de maioridade, menoridade apurada, suspensão, exclusão, hold, assinatura ou projeção pública | Revisão separada | Excluir da limpeza por abandono |
| Recibo por UID, documento legado, ausência de Auth compatível ou de datas confiáveis | Revisão separada | Preservar para reconciliação |

A simulação usa os documentos privados explicitamente incompletos, confirma a conta no Auth, considera as evidências de idade e a projeção pública, e calcula a inatividade a partir das datas confiáveis de criação, sessão, aceite ou decisão etária. Um UID existente só no Auth fica fora do conjunto automático. A conta concluída segue a política normal de conta. O rascunho de edição local do perfil tem prazo de 24 horas e guarda somente os campos permitidos.

Com **Auth e Firestore Emulator** ativos, execute na raiz do repositório.

```sh
node scripts/maintenance/audit-registration-draft-cleanup-emulator.mjs --dry-run
```

O relatório reúne contagens de rascunhos temporários vencidos (`expiredDrafts`), válidos (`validDrafts`), recibos de contas (`accountReceipts`) e registros que ficaram fora da classificação (`unclassified`). Ele usa `expiresAtMs` com uma referência de horário fixa. A consulta é somente leitura e o resultado contém só contagens e metadados da execução. Recibos por UID preservam os dados já vinculados ao cadastro.

O objeto `accounts` separa contas na janela, candidatas, protegidas e sem classificação segura. O comando só aceita endereços locais. Por padrão usa o projeto `entretenimento-sexual`, Auth em `127.0.0.1:9099` e Firestore em `127.0.0.1:8080`. Para um emulador isolado, configure `FIREBASE_AUTH_EMULATOR_HOST`, `FIRESTORE_EMULATOR_HOST` e `FIREBASE_PROJECT_ID`.

Uma futura rotina de limpeza deve operar em lotes, permitir aviso e janela de retomada, conferir novamente o estado e os vínculos imediatamente antes da operação e proteger evidências com obrigação de retenção. Deve coordenar Auth, documento privado, apelido, projeções e recibos, com retomada idempotente após falha parcial. O relatório atual é somente leitura.

## Regra de liberação do novo cadastro

Para a experiência adulta, o contrato de lançamento exige verificação confiável de maioridade antes da liberação das áreas restritas. Quando houver oferta de conteúdo pornográfico, a regra alcança a criação de conta ou perfil. O novo cadastro deve exigir sinal confiável **antes de criar a conta**, incluindo e-mail/senha, link e provedores sociais. Enquanto a prova faltar, as superfícies públicas se limitam a cadastro, recuperação, documentos legais e suporte. Autodeclaração pode registrar intenção e servir à prévia local. A autoridade para o conteúdo restrito vem de um resultado 18+ válido, vinculado ao usuário, verificável e revogável.

A integração escolhida deve confirmar somente a faixa 18+, com emissor, referência pseudonimizada, data, validade e versão da política. Use comprovação de origem no servidor, rejeição de reaproveitamento por outra conta, fluxo de revisão e convergência de Functions, Rules, acesso a mídia e links já emitidos. Evite armazenar documento, biometria, data de nascimento exata ou material de verificação no cadastro. A decisão de acesso deve ser conferida a cada acesso restrito. A checagem pode reaproveitar evidência válida e revogável, sem pedir a mesma prova a cada tela.

Com `AGE_ADMISSION_MODE=VERIFIED_REQUIRED`, a função de bloqueio `blockDirectAuthRegistration` reserva a criação de novas contas para o provisionamento pelo servidor. Ela recusa o cadastro direto no Auth quando registrada no projeto de homologação com Identity Platform. Contas existentes continuam podendo entrar. Antes de criar `users/{uid}`, o trigger, a recuperação e a reserva de apelido exigem evidência confiável, vigente e vinculada ao mesmo UID. A conclusão pelo callable confere novamente a evidência. O fluxo de laboratório que cria UID por autodeclaração fica indisponível no modo verificado. A candidata de Rules impede a criação direta do documento privado, a conclusão e a primeira projeção pública pelo cliente.

O modo verificado ainda depende de um emissor confiável e de um fluxo de provisionamento que verifique a prova **antes** de criar o UID. A função de bloqueio do Firebase só cobre métodos alcançados pelos eventos de bloqueio. Autenticação anônima deve ficar desabilitada no projeto homologado, e emissores de tokens personalizados e operações do Admin SDK precisam ser controlados no servidor. Ao reverter a configuração de homologação, desregistre o gatilho no Auth antes de remover a função. Confirme separadamente a autorização de contas existentes para conteúdo restrito e a revogação de acesso antes de qualquer virada em produção.

Referências oficiais:

- [Lei nº 15.211/2025, art. 9º](https://www2.camara.leg.br/legin/fed/lei/2025/lei-15211-17-setembro-2025-797997-normaatualizada-pl.html)
- [ANPD, atos e orientações do ECA Digital](https://www.gov.br/anpd/pt-br/assuntos/eca-digital/)

## Certificação dos dois tipos de link

- **Confirmação de e-mail do cadastro vigente.** O SDK envia com `sendEmailVerification`. A página hospedada pede a ação **Confirmar e-mail**. Só após o clique o handler valida `VERIFY_EMAIL` com `checkActionCode` e consome com `applyActionCode`. Isso preserva o código quando um verificador de e-mail apenas visita a URL. A confirmação pode ser feita em outra sessão ou janela. O link confirma apenas seu destinatário, preserva a sessão de outra conta e pede que se entre com a conta confirmada para continuar. A integração do emulador usa essas operações reais do SDK e comprova a preservação da senha e a rejeição de reaproveitamento do código.
- **Cadastro futuro por autenticação com link.** O método nativo é `sendSignInLinkToEmail`, `isSignInWithEmailLink` e `signInWithEmailLink`. Use o e-mail salvo localmente ou solicite o endereço em outro dispositivo. O endereço fica fora da URL. O link não substitui a prova 18+ nem pode trocar a credencial de uma conta anterior. Antes de habilitar, teste contas existentes com e sem endereço verificado, nova conta, mesmo e outro dispositivo, duplicação, vencimento, troca de sessão e rejeição de destinatário divergente.
- **Certificação em ambiente hospedado.** Depois de configurar um projeto de homologação, validar entrega real, domínio HTTPS autorizado, template e handler de ação, `continueUrl`, provedores e recuperação. A simulação local não comprova entrega nem configuração de domínio. O método de consulta de códigos do emulador é exclusivo do laboratório.

[Validação por link de autenticação no Firebase](https://firebase.google.com/docs/auth/web/email-link-auth?hl=pt-BR) · [Handler de confirmação do Firebase](https://firebase.google.com/docs/auth/custom-email-handler)

### Ensaio de homologação do e-mail

Use o projeto isolado `entretenimento-staging` e uma origem HTTPS cadastrada em **Authentication → Authorized domains**. Configure App Check para esse app Web de staging e o template de verificação para apontar ao handler hospedado em `/post-verification/action`. O `continueUrl` do SDK é o retorno ao cadastro e está separado da URL do handler.

No PowerShell, confira o App Check e a compilação de staging com `npm.cmd run appcheck:staging:check` e `npm.cmd run build:staging`. Depois de disponibilizar o build no ambiente isolado, use caixas de e-mail de teste para registrar os resultados de entrega, visita à página sem consumo do código, confirmação com clique, outro dispositivo, outra conta ativa, código expirado e tentativa de reutilização. Registre o resultado de cada caso sem colar o código do link ou o endereço pessoal nos logs. Para testar o fluxo vigente enquanto o provisionamento verificado está pendente, use contas de teste previamente preparadas no projeto isolado. A confirmação de e-mail e o login por link são certificações distintas.

O App Check de staging precisa de uma site key reCAPTCHA Enterprise associada ao domínio efetivamente usado. A configuração no repositório ainda está sem essa chave.

[Funções de bloqueio do Firebase Auth](https://firebase.google.com/docs/auth/extend-with-blocking-functions)

## Risco documentado pelo Firebase — contas já existentes

O Firebase Auth informa que a autenticação por link pode **invalidar sessões anteriores e remover a senha de uma conta criada com e-mail/senha ainda não verificada**, no momento em que o link é consumido. Isso não pode ser introduzido silenciosamente em um cadastro existente. Fonte: https://firebase.google.com/docs/auth/web/email-link-auth

A ativação do novo provedor dependerá de um teste reproduzível em Auth Emulator com contas antigas (e-mail verificado/não verificado), link usado em outra sessão, criação de senha após o link, e um bloqueio inequívoco contra entrada em perfil de outra conta. Não usar `sendEmailVerification` como substituto de `sendSignInLinkToEmail`. Enquanto o teste não passar, manter **desativada** a nova jornada de autenticação.

As duas cenas fotográficas WebP foram integradas à `main` no commit `4f3922c7`. Não depender de imagens externas, instaladores locais ou artefatos não versionados.

## Dependências de segurança obrigatórias antes da virada
- **Autoridade etária:** o fluxo atual exige declaração 18+ antes de criar o UID. Como `signInWithEmailLink` cria/autentica a conta no primeiro clique, preservar a declaração pré-Auth na própria confirmação do link, imediatamente antes de consumi-lo; não presumir maioridade com base em e-mail confirmado. O backend conserva a confirmação pré-Auth com UID, data e versão. Depois dos Termos, a evidência vigente alimenta a reconciliação canônica sem repetir a pergunta. Um cadastro antigo sem evidência aproveitável passa pela etapa 18+.
- **Estado canônico:** introduzir `passwordSetup` como etapa do `RegisterFlowFacade` / `RegisterNavigationService` somente com evidência de criação de credencial; conta recém-autenticada por link sem senha não pode pular para Termos, Perfil ou Preferências. Estado protegido pelo backend, vinculado ao UID e resistente a troca de sessão.
- **Autenticação:** conferir os provedores e a sessão no Firebase Auth. `updatePassword` exige autenticação recente; após perder a sessão, reautenticar por link. Não inferir senha definida de uma flag controlada pelo navegador. A transição de provedor não pode resetar credenciais de uma conta existente.
- **Reserva:** o backend valida a disponibilidade do apelido principal na transação de conclusão do perfil. Em caso de conflito, a etapa pede outro apelido e mantém os demais dados preenchidos.
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
- As cenas WebP de `/register` compartilham o fundo escuro radial. A partir de `52rem` de largura e acima da proporção `7/5`, o formulário fica à direita. A foto de apelido usa `object-fit: cover` com foco no alto e largura limitada pela altura útil. As cenas de e-mail e declarações usam o mesmo preenchimento em proporções a partir de `2/1` e conservam o enquadramento integral nas demais janelas horizontais. Em uma coluna, a imagem preenche a largura, o foco muda conforme a cena e a faixa se adapta à altura e à largura disponíveis. A altura da faixa se mantém ao trocar de etapa e o formulário centralizado começa logo abaixo. O documento rola quando o conteúdo precisa de mais altura.
- A tela inicial seleciona a composição pelo `<picture>`. Nas janelas em uma coluna, a versão em retrato aproxima os rostos do centro e oferece fontes de 640 e 1024 pixels de largura. Nas janelas em duas colunas, a composição original em paisagem deixa espaço à direita para o formulário.
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

- Em `dev-emu`, `/register` começa com o endereço de e-mail. A ação **Continuar com e-mail** apresenta **Confira seu e-mail** depois do envio. Em testes locais, copie o link do log do Auth Emulator. O retorno abre a etapa 18+, seguida por Senha, Termos e Perfil, ou orienta a entrar se já existe uma conta com senha.
- No emulador, `prepareEmailLinkRegistration` confirma o código e resolve o destinatário no Auth local, devolvendo o endereço ao portador do link válido para o consumo pelo Firebase Auth. O callable reserva um UID por meio da unicidade do Firebase Auth. Antes do consumo nativo, recusa contas fora da prévia e contas cuja senha já foi configurada. A resposta de envio permanece genérica.
- `passwordSetup` consulta a credencial no Auth Emulator e limita a definição de senha à sessão e ao UID esperados. As operações de Termos, maioridade, reserva de apelido e perfil conferem a credencial no backend. A tela consulta o que foi salvo antes de repetir uma gravação de senha que ficou sem confirmação.
- Links novos de quem começa pelo e-mail dispensam o rascunho de apelido no emulador. Links anteriores continuam aceitando a referência opaca e a validam contra o destinatário. Em um reenvio na mesma aba, o apelido de um rascunho antigo pode ser recuperado para o e-mail original. Se houver disputa pelo apelido ou se nenhum estiver vinculado, a escolha pode ser feita em Perfil.
- Em Perfil, a identificação usa o catálogo de perfil vigente. A orientação sexual é opcional, e o formulário informa que a escolha aparece no perfil. O e-mail fica no cadastro privado. O rascunho local de conclusão de perfil salva apenas apelido, identificação e UF. Ao abrir a aplicação, rascunhos anteriores são reescritos com esses campos e mantêm sua expiração original. Município e orientação preenchidos no formulário precisam ser informados novamente se a página for fechada antes de salvar.
- Os callables desta fase são exportados somente no Functions Emulator. A reserva baseada na verificação local de códigos é específica da prévia. A arquitetura para habilitação remota e os critérios de virada continuam pendentes.
