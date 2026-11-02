# Nickname — decisão de rollout GO/NO-GO (P1)

**Status:** NÃO implantar ainda. Esta documentação é runbook de
pré-flight, não autorização nem comando de deploy.

## Ponto atual

- Cadastro Angular novo usa reserveRegistrationNickname e
  completeRegistrationProfile. Foi validado por E2E em emulador.
- A versão candidata de Firestore Rules nega o batch legado de
  conclusão e criação do índice, mas não é a regra ativa.
- Usuários e índices legados ainda não foram auditados integralmente
  no ambiente real.
- Clientes antigos ainda podem tentar concluir por operações diretas
  no Firestore. O CI testa só o código atual, não sessões antigas.
- O índice público de nickname hoje permite GET mesmo para contas em
  cadastro, e a reserva server-side nasce antes da projeção pública.
  **Risco de exposição de UID/nickname**: revisar a autorização de
  leitura e substituir a checagem pré-auth do registro por alternativa
  que não exponha documentos. Não promover lockdown sem resolução.

## Portões necessários

1. Implantar callables compatíveis primeiro, verificar App Check,
   autenticação, termos v3 e admissão etária vigente em homologação.
2. Inventariar todos os usuários de modo integral e sem dados pessoais
   nos logs. Usar audit-nickname-cutover-readonly.mjs. Somente
   um scan com truncated=false pode servir de evidência.
3. Executar backfill-nickname-reservations-admin.mjs em dry-run para
   achar índices órfãos/duplicados. candidate>0 significa que a
   migração ainda não foi executada; conflito não pode ser reparado
   por heurística nem liberado para outro UID.
4. Monitorar e impedir clientes com versão antiga que fazem writes
   diretos. Registrar evidência de zero tentativas de bypass por
   janela mínima inicial de 30 dias, sem coletar dados íntimos.
5. Comprovar cadastro social + email, falha segura, reversão,
   idade, aceite e notificações sem alterar nomes de métodos.
6. Resolver a visibilidade de public_index/nickname e o tratamento
   de disponibilidade de nickname antes do login.
7. Revisar segurança, privacidade, retenção e suporte; obter
   autorização humana para implantação coordenada.

## Ferramenta offline de decisão

Com relatórios JSON **agregados e sem PII** de inventário,
dry-run de índices e uma declaração de evidências de rollout:

    npm run nickname:cutover-readiness -- --inventory relatorio-users.json --index-scan relatorio-indices.json --rollout evidencias.json

A ferramenta retorna NO_GO com motivos específicos quando os
relatórios estão ausentes, incompletos ou inconsistentes, ou quando
qualquer requisito de rollout não foi confirmado. REVIEW_READY
significa apenas que a equipe pode deliberar manualmente sobre a
implantação; deploymentAuthorized permanece false. Nenhuma
alteração de produção é executada por esses scripts.

## Onde atuar na hora da implantação

O gerador de candidata é build-registration-lockdown-candidate.mjs,
com E2E de emulador aprovado. Somente depois de fechar os
portões, revisar manualmente as mudanças nas origens
firestore-rules/users.rules,
firestore-rules/public_profiles_next.rules e
firestore-rules/public_index.rules.
Nunca editar diretamente o arquivo firestore.rules gerado.
Não fazer deploy incidental, branch, PR ou merge.

## Referências de outros serviços

Consultar docs/references/README.md para Sexlog, Casal Real e
SexoComCafé. São inspiração de políticas de consentimento,
suporte e verificação de casal; não equivalem a autoridade
técnica ou jurídica sobre o Entretenimento.

## Pré-consulta anônima sem exposição de reserva

`getRegistrationNicknameAvailability` recebe apenas o nome de exibição,
aplica App Check e rate limit backend (10/minuto, 80/hora por origem de
rede) e devolve somente `{status: 'taken' | 'unconfirmed'}`.
`taken` significa que a conta e a projeção pública estão ativas;
a ausência de nome, reserva de cadastro pendente, perfil oculto ou
suspenso recebem sempre `unconfirmed`. Não retornar documentos do índice,
UID, e-mail, nem motivo do estado. A resposta `unconfirmed` nunca
é garantia de disponibilidade; somente a reserva autenticada transacional
autoriza a escolha. Na interface Angular, o feedback é provisório.

A candidata de Rules também bloqueia `get` client-side em
`public_index/nickname:*` para anônimos e autenticados. O E2E
verifica ausência de leitura direta e ausência de diferenciação de
reservas pendentes. A Rule ativa permanece com acesso legado até
que o endpoint e o cliente estejam implantados, e a telemetria
comprove compatibilidade; **não promover isoladamente**.

A consulta prévia oferece somente status agregado; não usar
essa API para enumerar identidades. Reavaliar proteção contra
abuso, custo do rate limit, retenção de registros e cadência
de resposta antes do rollout real.


## Relatórios JSON operacionais (auditoria corrigida)

Os dois scanners de nickname emitem relatório JSON **agregado** com
`schemaVersion`, `projectId`, `mode`, `startedAt`, `completedAt`,
`truncated` e contadores. A verificação de conclusão do scan utiliza
uma leitura adicional depois do último documento: atingir exatamente
`MAX_USERS` ou `MAX_RECORDS` **não** prova que faltam registros.

Em PowerShell, com Firebase Admin SDK já configurado de forma autorizada:

```powershell
npm run functions:build
$env:FIREBASE_PROJECT_ID = 'ID_DO_PROJETO'
$env:NICKNAME_AUDIT_MAX_USERS = '1000'
$env:NICKNAME_AUDIT_REPORT_PATH = './nickname-users-readonly.json'
node scripts/maintenance/audit-nickname-cutover-readonly.mjs

$env:NICKNAME_RESERVATION_DRY_RUN = 'true'
$env:NICKNAME_RESERVATION_MAX_RECORDS = '1000'
$env:NICKNAME_RESERVATION_REPORT_PATH = './nickname-indices-dryrun.json'
node scripts/maintenance/backfill-nickname-reservations-admin.mjs
```

As saídas são arquivos locais exclusivos, com permissão restrita,
sem sobrescrever relatórios anteriores. Não incluir tais arquivos no Git.
Eles contêm apenas contadores agregados, mas devem permanecer fora de
repositórios públicos e ser revisados antes de compartilhamento. Os comandos
não foram executados em ambiente real por esta revisão.

Avaliador offline (ainda requer comprovação de rollout em JSON separado):

```powershell
npm run nickname:cutover-readiness -- --inventory ./nickname-users-readonly.json --index-scan ./nickname-indices-dryrun.json --rollout ./evidencias-rollout.json
```

Quando `truncated=true`, aumentar a capacidade da auditoria e
repetir, sem alegar completude. **Se a base superar o limite suportado,
não fragmentar relatórios manualmente para forçar aprovação**: implementar
paginação validada e agregação segura antes de deliberar sobre o cutover.
Mesmo `truncated=false` não garante consistência instantânea sob escritas
concorrentes; conferir horário e repetir com operações estabilizadas.
