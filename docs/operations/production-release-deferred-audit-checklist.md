# Memento — auditoria Firestore e cutover de nickname para o deploy de produção

> **Status em 03/11/2026: ADIADO POR CUSTO / NÃO EXECUTAR AGORA.**
> Documento de pré-deploy, **não** autorização de execução. A decisão do
> proprietário é desenvolver normalmente, sem habilitar logs de Data Access
> pagos apenas para iniciar antecipadamente a certificação de 30 dias.
> Revisar este documento no planejamento do futuro lançamento.

## Onde se aplica

| Ambiente | Projeto Firebase | Situação verificada em 03/11/2026 |
| --- | --- | --- |
| Desenvolvimento | Firebase Emulator (`dev-emu`) | Testes locais; não servem como certificação LIVE |
| Homologação | `entretenimento-staging` | Hierarquia IAM sem pais; pré-diagnóstico retornou `DATA_WRITE=false`, retenção de 30 dias e nenhuma amostra |
| Produção | `entretenimento-sexual` | Hierarquia IAM sem pais; pré-diagnóstico retornou `DATA_WRITE=false`, retenção de 30 dias e nenhuma amostra |

O usuário chegou a selecionar **Firestore/Datastore API → Gravação de dados**
no Console de homologação, **sem comprovação de que tenha salvado**.
A intenção registrada depois foi **não ativar a auditoria agora**, por
causa de custos na fase de desenvolvimento. Não presumir o estado atual do
Console: repetir o diagnóstico antes de qualquer decisão.

## Pendências para o futuro pré-deploy

- [ ] **Autorizar o gasto:** avaliar custos e volume esperado dos registros
  `DATA_WRITE`, retenção acima de 30 dias e eventual exportação. Registrar
  responsável, orçamento, alertas e decisão sobre o que efetivamente será ativado.
- [ ] **Verificar o projeto de destino:** confirmar pelo ID, não pelo apelido.
  Nunca misturar `entretenimento-staging` e `entretenimento-sexual`; validar
  credenciais e acessos mínimos, sem publicar relatórios ou tokens.
- [ ] **Preparar em homologação:** após aprovação específica, habilitar
  somente `DATA_WRITE` para o serviço IAM `datastore.googleapis.com`
  (Firestore/Datastore API). Não habilitar `DATA_READ`,
  `allServices` ou isenções indiscriminadas.
- [ ] **Revisar Cloud Logging:** sinks, filtros, políticas IAM locais/herdadas,
  bucket de destino, acesso a logs privados, prazo de retenção mínimo de
  **31 dias** se mantida a política de certificação e possibilidade de cobrança.
- [ ] **Comprovar cobertura real de gravações:** executar testes controlados,
  em ambiente autorizado, de escritas permitidas e negadas por Security
  Rules; verificar que ambos os tipos aparecem na fonte usada. Não assumir
  que uma resposta de consulta vazia prova ausência de tentativas.
- [ ] **Comprovar atribuição de clientes e caminhos:** garantir identificação
  confiável de versões antigas e dos caminhos de conclusão de cadastro e
  índices de nickname, inclusive escritas negadas, sem registrar UID, e-mail,
  IP, nickname, JWT ou payload em relatórios de certificação.
- [ ] **Revisar a migração de nickname:** inventário LIVE integral
  (`truncated=false`), dry-run de índices, compatibilidade dos clientes,
  Cloud Functions e App Check, elegibilidade etária, aceite, cadastro email/
  social, privacidade de `public_index`, Rules candidatas, testes E2E e
  estratégia de reversão — conforme o runbook canônico abaixo.
- [ ] **Registrar D0 apenas depois das provas:** obter revisão e aprovação
  de segurança/operação; documentar o D0 não retroativo e monitorar
  **720 horas UTC consecutivas** (30 dias) com cobertura e atribuição
  comprovadas, sem lacunas ou tentativas legadas/desconhecidas. O prazo
  ainda não começou. Se a regra de 30 dias for reavaliada antes do
  lançamento, essa mudança exigirá decisão expressa e atualização dos testes;
  nunca inventar dias de observação.
- [ ] **Deliberar o GO/NO-GO:** relatório do avaliador pode indicar
  `REVIEW_READY`, mas não autoriza deploy; a decisão final precisa ser
  humana, documentada e específica para o ambiente.

## Domínio internacional e privacidade cadastral

**Decisão recomendada para o pré-deploy.** Escolher um `.com` de marca neutra,
sem conotação sexual nem dados pessoais. Usar Cloudflare Registrar e o DNS da
Cloudflare em modo `DNS only`, com o Angular servido no domínio próprio pelo
Firebase Hosting. Manter Auth, Functions e Firestore nos projetos próprios de
cada ambiente. Apresentar o serviço com precisão como uma plataforma para
maiores de 18 anos, inclusive na marca e na descrição exibidas pelo Google
OAuth. Confirmar separadamente o provedor que armazenará e entregará mídia
explícita. A compra, o DNS e a configuração dos serviços ficam para a execução
autorizada do pré-deploy.

**Limite de privacidade.** A Cloudflare retém o cadastro completo e pode
ocultar campos pessoais na consulta pública, conforme a extensão. A
documentação informa que estado e país do titular ficam públicos. O
proprietário aceita essa exposição geográfica e exige a ocultação de seu
nome pessoal na consulta pública do domínio. O Registrar exige os
nameservers da Cloudflare.
[Ocultação cadastral na Cloudflare](https://developers.cloudflare.com/registrar/account-options/whois-redaction/)
· [Contrato do Cloudflare Registrar](https://www.cloudflare.com/domain-registration-agreement/)
· [Modo DNS only](https://developers.cloudflare.com/dns/proxy-status/).

### Ordem de prioridade e execução

1. [ ] **Definir o operador e a identificação pública.** Definir o titular
   real do domínio e quem responde pela plataforma. Identificar quais dados
   precisam ser divulgados no site, nos Termos, no aviso de privacidade e
   na contratação on-line, se aplicável. Resolver antes da compra qualquer
   conflito entre a divulgação exigida e a meta de manter o nome pessoal
   do proprietário fora das superfícies públicas.
2. [ ] **Planejar a marca e os contatos institucionais.** Preparar
   uma lista privada de nomes neutros e definir nome de exibição, identidade
   visual e descrição do serviço 18+. Definir endereços de função para
   suporte, privacidade, denúncias e remetentes do cadastro e da recuperação
   de senha. Atribuir responsáveis e inventariar URLs, marcas e contatos
   que podem aparecer no app, no Google OAuth e nos e-mails. Preparar o
   roteiro de homologação com contas e mídia sintéticas.
3. [ ] **Aprovar o nome e a extensão.** Conferir disponibilidade, conflito de
   marca e reputação de uso anterior do domínio. Comparar o custo de registro e
   renovação de registradores acreditados pela ICANN e confirmar que a política
   do registrador e do registro da extensão admite o uso planejado.
4. [ ] **Confirmar a privacidade antes de pagar.** Solicitar ao registrador a
   lista de campos que ficarão públicos no RDAP e no WHOIS, quando disponível.
   Selecionar uma combinação de extensão e registrador que oculte o nome pessoal
   do titular, endereço, telefone e e-mail pessoais desde o primeiro dia.
   Conferir se a opção é redação de dados ou serviço de proxy, quem consta como
   titular e as condições de renovação, transferência e divulgação de dados.
   Usar dados cadastrais válidos e confirmar os campos que continuarão públicos.
   [Privacidade e proxy na ICANN](https://www.icann.org/en/contracted-parties/accredited-registrars/privacy-and-proxy-service-providers)
   · [Consulta pública ICANN Lookup](https://lookup.icann.org/en).
5. [ ] **Validar os termos por serviço.** Registrar quais serviços hospedam ou
   processam as páginas, perfis, fotos e vídeos de usuários. Revisar o uso
   adulto previsto nos termos vigentes de DNS/CDN se aplicável,
   Firebase Hosting, Auth, Functions, Firestore, Storage, App Check e FCM.
   Descrever ao provedor que o uso envolve armazenamento e entrega de fotos e
   vídeos sexualmente explícitos enviados por usuários adultos. Registrar
   confirmação por escrito para o produto escolhido antes de aceitar arquivos
   reais. Se a permissão do Storage permanecer indefinida, avaliar outro
   provedor apenas para os arquivos, mantendo o domínio e a autenticação.
   Validar também aferição de idade, autorização das pessoas retratadas,
   moderação e retirada de acesso a arquivos e miniaturas.
   [Termos do Firebase por produto](https://firebase.google.com/terms/)
   · [Política de uso do Google Cloud](https://cloud.google.com/terms/aup).
6. [ ] **Registrar e conferir a consulta pública.** Após aprovar nome,
   privacidade, termos e orçamento, comprar com a proteção cadastral ativa.
   Conferir o RDAP em sessão pública sem login e consultar o WHOIS quando
   oferecido. Guardar a comprovação sem dados pessoais e repetir a checagem
   após renovação, transferência ou alteração cadastral. Proteger a conta do
   registrador com MFA e configurar alertas de renovação.
7. [ ] **Integrar DNS, HTTPS e o Angular.** Definir o host público canônico e
   testar o redirecionamento de `www` ou do domínio raiz, quando usados.
   Confirmar propriedade DNS e certificado no Firebase Hosting do projeto
   correto. Validar arquivos estáticos, recarga de rotas internas, callback de
   Auth e ausência de conteúdo misto. Separar os hosts e configurações de
   staging e produção. Conferir origens autorizadas nas restrições de API,
   CORS e CSP onde aplicáveis. Revisar URLs públicas e mensagens para manter a
   marca neutra. O domínio próprio não renomeia o projeto Firebase, e o
   identificador técnico ainda pode aparecer em URLs e requisições do SDK.
   [Domínio próprio no Firebase Hosting](https://firebase.google.com/docs/hosting/custom-domain/)
   · [Deploy do Angular](https://angular.dev/tools/cli/deployment).
8. [ ] **Implantar a marca e os contatos institucionais.** Validar em staging
   antes de aplicar na preparação da produção. Aplicar nome, identidade
   visual e descrição à página inicial, ao app, aos metadados de
   compartilhamento, ao Google OAuth e aos e-mails transacionais. Publicar
   os contatos institucionais nos canais correspondentes e nas páginas legais.
   Configurar remetente e endereço de resposta institucionais, além da
   autenticação do domínio de e-mail conforme o provedor. Enviar e responder
   mensagens de teste para confirmar a entrega, o encaminhamento aos
   responsáveis e os dados de contato exibidos ao destinatário.
9. [ ] **Homologar o host final e a exposição pública.** Revisar domínios
   autorizados, `authDomain`, URLs de ação e de retorno para cadastro por link,
   verificação de e-mail e recuperação de senha. Se o login Google estiver
   habilitado, validar origem HTTPS, callback OAuth, marca e domínio verificados,
   página inicial, Termos e aviso de privacidade. Testar login, logout, retomada
   de cadastro, callables protegidas, upload e leitura protegida de mídia.
   Configurar o host autorizado na chave do reCAPTCHA e validar tokens do App
   Check com o provedor de cada ambiente. Validar inscrição e desinscrição de
   Web Push no novo host, com o service worker e a VAPID do projeto certo,
   conforme a seção abaixo. Repetir os testes nos hosts autorizados de staging
   e produção antes da liberação do tráfego público. Em uma sessão sem login,
   conferir o RDAP, o site, os metadados, a tela do Google, os e-mails de
   teste e os canais de atendimento. Confirmar que a marca e os contatos
   institucionais aparecem nos pontos previstos e que os dados pessoais
   exibidos se limitam ao que foi aprovado na primeira etapa.
   [Domínio de redirecionamento do login Google](https://firebase.google.com/docs/auth/web/google-signin#customizing-the-redirect-domain-for-google-sign-in)
   · [Verificação de marca e domínios OAuth](https://developers.google.com/identity/verification/authentication-policy-compliance?hl=pt-br)
   · [App Check Web com reCAPTCHA v3](https://firebase.google.com/docs/app-check/web/recaptcha-provider?hl=pt-br)
   · [App Check Web com reCAPTCHA Enterprise](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider?hl=pt-br).

Registrar no GO/NO-GO as evidências de privacidade cadastral, marca e contatos
institucionais, adequação aos termos dos serviços e homologação no host
público definitivo.

## App Check e Web Push no ensaio da release

A ativação do Fraud Defense para `entretenimento-staging` fica para o
planejamento pré-deploy, com tempo para homologar o cadastro antes da
publicação. Durante o desenvolvimento, seguir com os testes no emulador.

- [ ] Conferir a franquia mensal compartilhada e a estimativa de uso no
  [painel do Fraud Defense](https://console.cloud.google.com/security/recaptcha?project=entretenimento-staging)
  antes de decidir sobre a ativação da API em staging.
- [ ] Registrar o app web de staging no App Check com uma chave Web baseada
  em pontuação para o domínio de homologação. Configurar a chave pública do
  site e a chave pública VAPID do projeto de staging no frontend.
- [ ] Executar `npm run validate:staging` e verificar no domínio de staging a
  emissão de tokens do App Check e o cadastro com as Functions, incluindo
  troca de conta, perda de conexão e retomada da etapa pendente.
- [ ] Com Web Push ativo em uma conta de teste A, verificar um aviso com o app
  em segundo plano. Derrubar a rede durante a saída, gerar um novo aviso para
  A, reconectar e repetir após entrar como B no mesmo navegador. Repetir a
  saída com outra aba aberta e com recarga durante a confirmação do SDK.
  Conferir que a conta A não volta após a recarga e que nenhum aviso de A
  chega após a reconexão, inclusive com a aba fechada. Ativar Push em B e
  confirmar que os avisos dela chegam normalmente. Verificar o Chrome e
  demais navegadores suportados, incluindo avisos genéricos do próprio
  navegador se a entrega for descartada pelo service worker.
- [ ] Gerar o build do projeto de destino e executar `node scripts/quality/check-hosting-auth-assets.mjs`.
  O Firebase CLI também executa essa verificação antes de publicar o Hosting.
  Depois da publicação, confirmar que `/assets/firebase-messaging-sw.js` é
  servido como JavaScript e que a SPA abre as rotas de recuperação.
- [ ] Publicar Functions e o service worker no mesmo ciclo de release. Verificar
  a atualização do worker de uma instalação existente. Na Web, a Function
  envia alertas sem fila quando o navegador está offline, e o worker exige um
  vínculo ativo antes de exibir. Instalações antigas voltam a receber avisos
  na próxima abertura autenticada que sincronizar o opt-in existente. A
  Central mantém as notificações para consulta.
- [ ] Conferir o provedor do App Check e a configuração de Web Push do projeto
  `entretenimento-sexual` antes da liberação pública, seguindo o
  [runbook de produção](../production-deployment-runbook.md).

## Ferramentas de consulta (somente leitura)

```powershell
# Substituir pelo projeto a ser avaliado, após autorização operacional.
$env:FIREBASE_PROJECT_ID = 'entretenimento-staging'
node .\scripts\maintenance\check-nickname-firestore-logging-readonly.mjs
npm run nickname:audit-inheritance-readonly
```

Para o projeto principal, usar explicitamente
`$env:FIREBASE_PROJECT_ID = 'entretenimento-sexual'` e repetir a leitura
antes de planejar qualquer mudança. Essas ferramentas **não ativam logs**,
não alteram Rules e não certificam D0 por conta própria.

**Referência técnica canônica:** [Runbook de cutover de nickname](./registration-nickname-cutover-runbook.md).
Os relatórios e atestados reais devem permanecer fora do Git. Nunca incluir
segredos, tokens, dados pessoais ou extratos de logs no repositório.

**Revisão no futuro:** na abertura do plano de deploy, atualizar as caixas
e anexar apenas referências internas às evidências. Não interpretar a
ausência de evidência como aprovação.
