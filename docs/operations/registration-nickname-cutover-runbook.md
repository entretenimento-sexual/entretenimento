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
`schemaVersion: 2`, `projectId`, `mode`, `environment`, `startedAt`, `completedAt`,
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

## Evidência da janela de clientes legados (P0)

A declaração de rollout não pode mais comprovar a ausência de
clientes legados apenas com `zeroLegacyWritesObserved=true` e
`legacyObservationDays=30`. Exige também `legacyClientObservation`:

```json
{
  "schemaVersion": 1,
  "projectId": "ID_DO_PROJETO",
  "sourceKind": "REVIEWED_SERVER_TELEMETRY",
  "evidenceReference": "internal-audit/IDENTIFICADOR",
  "startedAt": "2026-10-01T00:00:00.000Z",
  "completedAt": "2026-11-01T00:00:00.000Z",
  "collectedAt": "2026-11-01T00:05:00.000Z",
  "coverageComplete": true,
  "attributionComplete": true,
  "deniedWriteCoverageComplete": true,
  "legacyCompletionWriteAttempts": 0,
  "unattributedCompletionWriteAttempts": 0
}
```

Este é um **exemplo de formato**, não uma evidência real ou uma declaração
de que a telemetria está implantada. Os campos devem ser comprovados por
dados de observabilidade revisados pela equipe, com origem controlada e
rastreabilidade interna. Não registrar UID, nickname, IP, e-mail ou payload
de cadastro no relatório. Monitorar especificamente tentativas de
conclusão do cadastro e escrita de índice de nickname pelo cliente
(aceitas e negadas); o seed social legítimo não é bypass.

O avaliador exige 30 dias efetivos de observação, período terminando
nas últimas 24 horas, coleta atual, ausência de lacunas, atribuição de
cliente e zero tentativa legada ou não atribuída. `environment=EMULATOR`
é rejeitado pelo avaliador mesmo com dados limpos. Os scanners registram
`LIVE` apenas quando `FIRESTORE_EMULATOR_HOST` não está presente.
Isso **não autentica as credenciais nem o ambiente por si só**: verificar
externamente destino, credenciais, logs e referência de evidência antes
de qualquer decisão humana. Sem observabilidade comprovada, manter NO-GO.

Os relatórios reais de Firestore e a janela operacional não foram
obtidos nesta etapa. Não executar escrita, migração ou deploy como
substituto das evidências.

## P0 — cobertura horária verificável e observabilidade real

**Atenção:** o JSON anterior é apenas um resumo ilustrativo e não basta
para REVIEW_READY. É obrigatório incluir no objeto
`legacyClientObservation` um array `hourlyCoverage` com **720 ou mais
horas UTC consecutivas** (30 dias), sem lacunas e com as somas exatas
de tentativas correspondendo aos totais do cabeçalho. Cada hora deve ter
somente os seguintes campos; exemplo ilustrativo de uma única hora:

```json
{
  "hourStart": "2026-10-03T12:00:00.000Z",
  "dataWriteMonitoringActive": true,
  "acceptedWriteCoverageComplete": true,
  "deniedWriteCoverageComplete": true,
  "clientAttributionComplete": true,
  "registrationCompletionPathsCovered": true,
  "nicknameIndexPathsCovered": true,
  "legacyCompletionWriteAttempts": 0,
  "unattributedCompletionWriteAttempts": 0
}
```

`startedAt` e `completedAt` devem cair em horas UTC exatas.
O primeiro registro inicia em `startedAt` e o intervalo é fechado
em `completedAt` (exclusivo). **Não preencher os indicadores true
artificialmente**. Eles precisam de comprovação operacional independente,
inclusive quando o total de eventos da hora for zero.
Uma única hora incompleta, tentativas diretas detectadas (aceitas
ou negadas), lacunas de classificação ou somas divergentes implica NO-GO.
Campos adicionais, inclusive de identificação pessoal, são rejeitados
na série horária.

A equipe operacional precisa validar habilitação, permissões e retenção
dos **Cloud Firestore Data Access Audit Logs**, verificar cobertura
de solicitações recusadas e aceitas e comprovar se a fonte registra a
versão ou outro marcador confiável dos clientes. Logs do serviço
`firebaserules.googleapis.com` referem-se à administração das Rules
e **não** substituem evidências das operações de dados do Firestore.
Não assumir que toda negação por Security Rules está capturada sem
validar essa capacidade no projeto e com testes controlados.
Verificar o custo e a retenção antes de ativar qualquer logging;
nada disso foi ativado por esta revisão.

Para facilitar a gestão do arquivo horário, o avaliador aceita
a série em um JSON local separado, sem dados pessoais:

```powershell
npm run nickname:cutover-readiness -- --inventory ./nickname-users-readonly.json --index-scan ./nickname-indices-dryrun.json --rollout ./evidencias-rollout.json --legacy-observation ./nickname-legacy-hours.json
```

Quando `--legacy-observation` for usado, omitir a chave
`legacyClientObservation` de `evidencias-rollout.json`. Nunca enviar
logs brutos, arquivos horários ou identificadores pessoais ao Git.
A ferramenta offline valida coerência, **não autentica** a fonte ou
prova que versões antigas foram totalmente eliminadas. Essa prova
ainda depende de inspeção dos registros originais, mecanismos de
bloqueio efetivos e aprovação humana.

## P0 — diagnóstico de Cloud Logging sem acesso a dados privados

Antes de atestar cobertura horária de 30 dias, um operador autorizado deve
verificar a configuração efetiva de auditoria da instância Firestore.
O serviço usado **na configuração de Data Access** em Firestore Native
é `datastore.googleapis.com`, enquanto o nome do serviço nos logs de
operações é `firestore.googleapis.com`.

Ferramenta opcional de pré-diagnóstico (somente leitura):

```powershell
$env:FIREBASE_PROJECT_ID = 'ID_DO_PROJETO_AUTORIZADO'
node scripts/maintenance/check-nickname-firestore-logging-readonly.mjs
```

Requer **gcloud CLI autenticado** e permissões de leitura da política IAM,
exclusões, bucket e Data Access Audit Logs do projeto. Data Access logs
na configuração padrão podem exigir `roles/logging.privateLogViewer`.
O comando consulta IAM de escopo projeto, exclusões do Cloud Logging,
retenção do bucket `_Default` na localização `global` e amostras de
timestamps dos registros de escrita das últimas 24h. **Não altera**
configurações, não executa escritas de teste nem imprime logs brutos.
Falha de permissão é classificada como `unavailable`, nunca como ausência
de eventos. Não inserir a saída em um repositório público.

Mesmo a presença de uma amostra de log aceita e uma negada não prova
cobertura por caminho, completude ou identidade da versão do cliente.
Uma ausência de amostra negada tampouco prova que ninguém tentou escrever.
A ferramenta deliberadamente retorna `NO_GO`, com
`deploymentAuthorized: false` e código de saída 2. Nunca converter
esse resultado em um atestado de zero tentativas de clientes legados.

A certificação completa exige: rever política herdada de organização/pasta,
exceções de principals, filtros de exclusão, sinks, buckets e retenção
efetiva; validar com casos controlados e autorizados, de preferência em
homologação, se tentativas diretas **aceitas e negadas** nas coleções
`users` e `public_index` aparecem nos registros; documentar mecanismo
real de atribuição da versão do cliente. Dados agregados de Security Rules
não comprovam o caminho nem a versão do cliente. Não habilitar logs,
criar sondas em produção ou modificar Rules sem autorização específica.

Referências oficiais:
- https://docs.cloud.google.com/firestore/native/docs/audit-logging
- https://docs.cloud.google.com/logging/docs/audit/configure-data-access
- https://firebase.google.com/docs/firestore/monitor-usage

## D0 oficial — certificação não retroativa da janela de 30 dias

O relógio de 30 dias **não começou automaticamente**. Antes de designar
D0, execute o pré-diagnóstico de leitura autorizado e obtenha comprovação
independente de testes de escrita controlada permitida e negada, cobertura
de ambos os caminhos de cadastro/índice, mecanismo verificável de versão
do cliente, retenção, rotas dos logs e aprovação de segurança/operação.
Amostras genéricas de Cloud Logging não comprovam essas propriedades.

O relatório agregado do pré-diagnóstico (JSON, sem logs brutos) e a
revisão operacional ficam em arquivos privados diferentes. Uma revisão
operacional precisa conter: `schemaVersion:1`, `environment:"LIVE"`,
`projectId`, `sourceKind:"INDEPENDENT_OPERATIONAL_REVIEW"`,
`evidenceReference`, `reviewedAt` em ISO UTC, e os seguintes controles
**somente após comprovação real**:
`controlledAllowedWriteVerified`, `controlledDeniedWriteVerified`,
`registrationCompletionPathsVerified`, `nicknameIndexPathsVerified`,
`clientVersionAttributionVerified`, `auditPolicyInheritanceReviewed`,
`routingAndRetentionReviewed`, `sensitiveDataMinimizationReviewed`,
`clientVersionFloorPlanReviewed`, `securityApproved`, `operationsApproved`.
Cada controle deve ser exatamente `true`, sem inferência de ausência de
tráfego. Guardar a referência à evidência fora do repositório.

```powershell
npm run nickname:d0-readiness -- --preflight ./nickname-logging-preflight.json --controls ./nickname-d0-operational-review.json
```

O resultado é `D0_BLOCKED`, ou `D0_CANDIDATE` com
`proposedStartAtUtc` **na próxima hora inteira UTC no futuro**.
Mesmo um candidato exibe `observationStarted:false` e
`deploymentAuthorized:false`. O operador deve confirmar e registrar
manualmente o começo efetivo da cobertura operacional. Não fabricar
um D0 anterior à verificação, nem alegar 30 dias só com relatórios
sintéticos ou flags `true`.

Após essa aprovação, manter em arquivo privado o
`rollout.d0Certificate` como referência da revisão original. Formato
mínimo de exemplo **não correspondente a uma aprovação real**:

```json
{
  "schemaVersion": 1,
  "projectId": "ID_DO_PROJETO",
  "status": "D0_APPROVED",
  "evidenceReference": "internal-d0-review/IDENTIFICADOR",
  "startedAt": "2026-11-04T12:00:00.000Z",
  "approvedAt": "2026-11-04T11:30:00.000Z",
  "securityApproved": true,
  "operationsApproved": true
}
```

O avaliador de cutover agora requer esse certificado, com referência
rastreável, autorização anterior ao D0 (em até 24 horas), coincidência
exata entre `startedAt` e o início da série horária de 30 dias,
mesmo `projectId` e revisões aprovadas. Isso é validação formal
do resumo, **não prova criptográfica**; a segurança da decisão depende
da auditoria humana dos registros de origem. O certificado não autoriza
deploy, não ativa logging e não altera Rules. Nenhum arquivo de
evidência de produção deve ser versionado.
