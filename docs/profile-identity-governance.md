# Identidade e privacidade de recursos — política escalável (P1)

## Mudança de identidade individual: autosserviço
O autosserviço descrito abaixo é histórico; a política v2 ao final prevalece para perfis com conexões.
Não há equipe dedicada de revisão. O callable `requestProfileIdentityChange`
continua com o mesmo nome, mas agora **aplica diretamente**, em uma
transação Firestore, as mudanças legítimas entre opções individuais do
catálogo. É necessário autenticação, App Check, cadastro concluído,
conta ativa e projeção consistente. O usuário confirma a mudança
explicitamente no formulário. Não depende de plano pago.

Somente uma alteração é permitida por janela de **90 dias**, medida no
backend pelo carimbo canônico `users/{uid}.identityChangedAtMs` e,
como compatibilidade, pelo último resultado `APPROVED`. A política
impede alternâncias frequentes, mas não afirma que detecta fraude.
Nenhuma troca publica a identidade antiga ou notifica terceiros sobre
históricos íntimos. UID, mídias, amizades e faturamento permanecem
inalterados; não se reinicia contagem de seguidores, não se inventa
autenticidade e não se modifica o controle de consentimento.

A transação sincroniza `users/{uid}` e `public_profiles/{uid}`,
inclusive `normalizedGender`, `normalizedOrientation` e
`compatibilityReady`, grava somente um estado privado da última
mudança e adiciona registro técnico restrito de auditoria. Pedidos
`PENDING` do mecanismo antigo podem ser convertidos por nova
confirmação do próprio titular. A fila manual anterior sai da navegação
normal; seus endpoints históricos não são a forma de operar novas
alterações.

### Composição de casal
Qualquer mudança que envolva casal, inclusive entre modalidades de
casal, é recusada automaticamente. Não se cria fila humana implícita.
Um procedimento posterior de consentimento vinculado às duas pessoas
deverá anteceder qualquer autorização de mudança estrutural. Não
tratar identidade trans, travesti ou crossdresser como suspeita.

## Recursos privados para contas gratuitas
A diretriz de produto é **não conceder a não assinantes novas
publicações com audiência restrita a amigos ou recursos exclusivos**.
Isso se refere a uma *capacidade de publicação*, jamais à perda da
proteção dos dados internos de uma conta gratuita. E-mails, mensagens,
identificadores internos, estado financeiro, conteúdo não publicado e
fotos que já estejam privadas continuam protegidos.

Nunca converter conteúdo privado antigo em PUBLIC no downgrade.
Primeiro impedir novas operações restritas, depois auditar projeções,
links temporários e leitura das mídias legadas com revogação segura;
retê-las protegidas até decisão expressa do titular ou nova assinatura.
A checagem de entitlement deve ser backend-only e baseada na
projeção versionada de billing, não em role autodeclarado.

## Validação
Sem branch, PR ou deploy. Compilar Functions, Angular, Rules e
executar as três suítes antes de avançar em outras autoridades.

## Operação: audiências de mídia para conta gratuita
A primeira regra de entitlement foi aplicada aos dois backend entrypoints de
nova mídia. Foto: `publishPhoto` valida a audiência selecionada antes de
copiar o arquivo publicado. Vídeo: `registerPrivateVideoUpload` valida antes
do registro canônico, dentro do ramo que remove assets de tentativas negadas.

`PUBLIC` permanece disponível para conta gratuita com audiência explicitamente
selecionada, moderação e bloqueios sociais intactos.
`FRIENDS` exige projeção de assinatura Basic+ ativa e vigente, com versão,
status, escopo e período validados no backend. A regra **não** muda audiência
preexistente, não exclui mídia antiga, não libera acesso a histórico privado
e não modifica estado sensível de pessoas sem assinatura.

Continua necessária auditoria de edição da audiência e de URLs assinadas de
mídias legadas, além de adaptação da UI para explicar a capacidade quando
não existir entitlement. Nenhum conteúdo restrito será publicado
automaticamente como `PUBLIC`.

## Audiências no frontend (P2)
Os editores de fotos e vídeos agora consomem a projeção reativa
`PlatformSubscriptionAccessService.isSubscriber$`. A opção `FRIENDS`
fica desabilitada quando a assinatura não está ativa; a seleção é
limpa se a assinatura expirar durante o preenchimento. A tentativa
de upload por evento ou código também falha fechado antes do envio
dos bytes. Nenhuma alteração automática para `PUBLIC` é realizada.

A autorização real continua nas Functions de publicação/registro,
não na UI. Os caminhos `publishPhoto`, `registerPrivateVideoUpload`
e `publishVideo` recusam `FRIENDS` sem assinatura Basic+ ativa.
`publishVideoWhenReady` utiliza `publishVideo` e herda a validação.
`updateVideoPublicationSettings` não aceita alteração de audiência,
somente metadados e preferências de interação.

Permanece pendente conferir as políticas de visualização de mídias
`FRIENDS` antigas quando a assinatura do proprietário vence,
incluindo URLs temporárias, queries de galeria e regras de visibilidade,
sem alterar unilateralmente a audiência do documento.

## Renovação de URLs após downgrade
Os contratos de emissão `getPublicPhotoAccessUrls` e
`getPublicVideoAccessUrls` agora exigem **entitlement ativo do
proprietário** para a audiência `FRIENDS` de terceiros, além de
amizade canônica. Essa verificação usa o documento de conta já lido
em lote por `resolvePublicMediaSignedOwnerExposure`, sem um read
extra por ativo. O titular mantém o acesso aos próprios arquivos.
Nenhuma audiência antiga muda para `PUBLIC` de maneira implícita.

URLs já emitidas podem continuar válidas até o TTL contratado;
a revogação instantânea exige rotação do ativo/credencial. As regras
de visibilidade de metadados e outras superfícies legadas ainda
precisam ser alinhadas antes da conclusão global da matriz.

## Comentários legados sob audiência FRIENDS
As Rules das subcoleções `public_photos/{id}/comments` negam agora o
acesso de terceiros a comentários de publicações `FRIENDS` quando
`isActiveSubscriber(ownerUid)` não está vigente. A função da camada
de segurança reutiliza os helpers canônicos da projeção financeira,
verifica o prazo com `request.time` e não equipara role `admin` a
assinatura. `PUBLIC` mantém a leitura conforme lifecycle e bloqueio
bilateral; o titular pode ler seus próprios comentários. Não altera
audiência, mídia ou histórico persistido.

Testes de Firestore Rules acrescentados: Basic ativo, cancelamento,
expiração temporal, role administrativa e acesso próprio.

## Política v2 — identidade, conexões e confiança

Identidade individual com amizade previamente aceita exige revisão administrativa,
sem discriminar plano gratuito, assinante ou identidade de gênero. O marcador privado
`users/{uid}.socialConnectionsEstablishedAt` é gravado nos dois perfis quando uma
amizade é aceita e não pode ser modificado pelo cliente. Amizades legadas ainda
ativas em `users/{uid}/friends` são consultadas para proteger contas antigas.
O estado `PENDING` preserva a identidade e a descoberta até uma decisão na fila
administrativa existente. A revisão deve permitir correções legítimas, com
justificativa e auditoria, sem presumir fraude nem revelar histórico íntimo a
terceiros. As mudanças estruturais de casal permanecem bloqueadas.
Uma decisão aprovada atualiza a data canônica da mudança e a descoberta.
O prazo de 90 dias permanece. Amizades encerradas antes da criação do marcador
necessitam de backfill para cobertura retrospectiva; outras métricas de
engajamento ainda exigem auditoria.

## Política v2 — sinais públicos do perfil gratuito

Nova gravação de preferências de conta sem assinatura exige
`visibility.showPreferenceBadges=true`. A interface pede confirmação explícita;
não altera o campo por conta própria. Conteúdo legado com opt-out não é
publicado automaticamente. O catálogo público continua sanitizado.
`showSeekingPublicly`, `showIntentPublicly`, `publicDescriptionVisible`,
práticas íntimas, dados cadastrais, documentos, conversas, localização precisa
e mídia privada seguem seus próprios controles e consentimento.

Pendente: especificar matriz canônica por campo para perfil gratuito, incluindo
descrição voluntária, descoberta, migração de legados e efeitos do downgrade.
Não obrigar ninguém a fornecer dados íntimos para ter uma conta gratuita.

Os 5.281 testes históricos validaram `33ccb29c`, não esta política.
Validar Functions, Rules e Angular antes de declarar o novo commit aprovado;
nenhum deploy está incluído nesta alteração.

## Nickname estável — autoridade da identidade social

O apelido definido no onboarding é estável após a conclusão do cadastro, em
qualquer plano. O titular não pode alterar `users/{uid}.nickname`,
`nicknameNormalized` ou `nicknameHistory` por SDK quando
`profileCompleted=true`; o histórico e a chave normalizada também não são
editáveis antes disso. O nickname existente não pode mudar na transação de
conclusão. O seed inicial vazio continua permitindo escolher nickname na
primeira conclusão do perfil.

O editor exibe nickname `readonly` (selecionável pelo teclado e cópia);
o draft não o restaura, e `ProfileEditSaveOrchestrator` e
`UsuarioService.atualizarUsuario` não o enviam. A `public_profiles`
não admite update de nickname/nicknameNormalized por cliente e a criação
requer a igualdade do apelido com o documento `users`.
O cliente também não pode excluir índices de nickname em `public_index`.

Correções legítimas exigem procedimento futuro por backend administrativo com
autorização, prova de controle da conta, auditoria, reserva atômica,
sincronização de índice/projeções e tratamento de links/caches. Não se concede
mudança automática por assinatura nem role administrativo client-side.

Lacunas a auditar: reserva de nickname ao ocultar/encerrar conta, unicidade
transacional de nicknameNormalized em perfis legados e possibilidade de
criação de aliases arbitrários no índice antes de reconciliação. Portanto,
não se afirma uma unicidade perpétua universal nesta etapa.
Os testes novos e CI precisam passar antes de homologação; nenhum deploy.

## Segurança da reserva de nickname e validação cruzada (P1)

O índice público `public_index/nickname:{key}` só pode ser criado pelo
titular quando a projeção pública do mesmo UID já contém `nicknameNormalized`
igual à chave e ao valor indexado. Isto preserva a transação original do
cadastro (que usa `getAfter`) e impede reservas client-side para aliases
totalmente desconectados da projeção. Exclusão de nickname pelo cliente é
proibida; o trigger `onUserCreateIndexNickname` remove somente entradas
`nickname:` e nunca apaga índices `email:` do mesmo UID.

A segurança descrita não equivale a unicidade histórica perpétua:
um cliente malicioso ainda pode tentar forjar `nicknameNormalized` no
documento público de criação, porque a normalização Unicode e a reserva
canônica do nome ainda ocorrem no fluxo de onboarding via cliente.
A futura migração deve passar criação e reserva para backend transacional,
com índice de ocupação privado, idempotência, migração de legados e políticas
de apagamento compatíveis com privacidade. Não remover o bloqueio atual.

O Quality Gate 9d6967a falhou também por lint (quebras de linha e
alinhamento de ternário), contrato visual inconsistente de showcase
sem ações, auditoria de dependências Functions e outros checks.
A fase corrente corrige lint e a incompatibilidade visual sem inserir
elementos vazios, preserva a proibição de links redundantes e adapta o E2E
de URL FRIENDS para proprietário com plano vigente/expirado. O audit de
dependências exige atualização e lockfile reproduzível, não dispensa do gate.
