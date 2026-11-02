# Identidade e privacidade de recursos — política escalável (P1)

## Mudança de identidade individual: autosserviço
Não há equipe de revisão. O callable `requestProfileIdentityChange`
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
