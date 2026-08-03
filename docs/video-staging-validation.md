# Homologação real do pipeline de vídeos

Este procedimento valida o fluxo de vídeo contra o projeto
`entretenimento-staging`. Ele não deve ser executado no projeto de produção.

## Objetivo

Comprovar no ambiente real:

```text
conta elegível
  -> reserva de quota
  -> Storage Rules
  -> registro privado
  -> job Firestore
  -> trigger de despacho
  -> Cloud Tasks
  -> Google Transcoder
  -> derivado privado
  -> publicação automática
  -> moderação pendente/aprovada
  -> painel operacional
  -> limpeza dos dados efêmeros
```

O smoke usa um usuário diferente para cada formato. Isso evita que o limite do
plano Free interfira na validação de MP4, WebM e MOV.

## Bloqueios atuais que devem ser resolvidos

A configuração versionada de staging ainda contém:

```text
appCheck.siteKey = staging-recaptcha-v3-site-key
apiEndpoint       = https://api.staging.seuprojeto.com
```

A site key de App Check é bloqueante. A auditoria estática falha enquanto esse
placeholder permanecer no `environment.staging.ts`.

O endpoint auxiliar não participa diretamente do smoke de Firebase, mas continua
sendo uma pendência para homologar o aplicativo completo.

Não inventar ou copiar uma chave de outro projeto. Criar o recurso de App Check
no projeto `entretenimento-staging` e versionar somente a site key pública
correspondente.

## APIs e faturamento

Confirmar faturamento ativo e APIs habilitadas:

```powershell
gcloud services enable firestore.googleapis.com `
  cloudfunctions.googleapis.com `
  run.googleapis.com `
  eventarc.googleapis.com `
  cloudtasks.googleapis.com `
  transcoder.googleapis.com `
  firebase.googleapis.com `
  identitytoolkit.googleapis.com `
  --project=entretenimento-staging
```

## Ordem obrigatória do primeiro deploy

Não promover Angular antes dos contratos backend e índices.

```text
1. firestore:indexes
2. Firestore Rules e Storage Rules
3. Functions
4. aplicação Angular de staging
5. smoke test real
```

Exemplo:

```powershell
firebase deploy --only firestore:indexes `
  --project entretenimento-staging

# Aguarde os índices ficarem READY antes da próxima etapa.

gcloud firestore indexes composite list `
  --project=entretenimento-staging

firebase deploy --only firestore:rules,storage `
  --project entretenimento-staging

npm run functions:prepare
firebase deploy --only functions `
  --project entretenimento-staging

npm run build:staging
firebase deploy --only hosting `
  --project entretenimento-staging
```

Também habilitar as duas políticas TTL do campo `cleanupAfter`:

```powershell
gcloud firestore fields ttls update cleanupAfter `
  --collection-group=media_video_processing_dispatches `
  --enable-ttl `
  --project=entretenimento-staging

gcloud firestore fields ttls update cleanupAfter `
  --collection-group=media_video_processing_dead_letters `
  --enable-ttl `
  --project=entretenimento-staging
```

## IAM do pipeline

A identidade real das Functions precisa de:

- criação de tasks na fila regional;
- invocação da task function;
- criação, consulta e cancelamento de jobs do Transcoder;
- leitura dos originais privados;
- escrita e exclusão dos derivados processados;
- acesso aos documentos técnicos do Firestore.

Papéis normalmente envolvidos:

```text
roles/cloudtasks.enqueuer
roles/cloudfunctions.invoker
roles/transcoder.admin
```

Não atribuir papéis ao endereço presumido de uma service account. Conferir a
identidade efetivamente implantada nas Functions de segunda geração.

## Identidade do workflow de smoke

O workflow `.github/workflows/video-staging-smoke.yml` não faz deploy. Ele usa
uma service account exclusiva para teste e limpeza.

Permissões mínimas esperadas para essa identidade:

- administrar usuários efêmeros do Firebase Auth;
- ler e gravar documentos efêmeros de Firestore;
- apagar objetos apenas do projeto de staging;
- assinar custom tokens para os usuários efêmeros;
- ler a configuração básica do projeto.

Papéis a avaliar no projeto de staging:

```text
roles/firebaseauth.admin
roles/datastore.user
roles/storage.objectAdmin
roles/iam.serviceAccountTokenCreator
```

`roles/iam.serviceAccountTokenCreator` deve ser concedido de forma restrita à
própria service account usada no smoke, somente para permitir a assinatura dos
custom tokens.

A identidade do smoke não deve receber permissão de deploy.

## GitHub Environment

Criar um Environment chamado:

```text
video-staging
```

Configurar aprovação obrigatória antes da execução e restringir o workflow às
branches autorizadas.

### Secrets

```text
GCP_WORKLOAD_IDENTITY_PROVIDER
GCP_VIDEO_STAGING_SERVICE_ACCOUNT
FIREBASE_STAGING_API_KEY
```

### Variables

```text
FIREBASE_STAGING_PROJECT_ID=entretenimento-staging
FIREBASE_STAGING_STORAGE_BUCKET=entretenimento-staging.appspot.com
FIREBASE_STAGING_AUTH_DOMAIN=entretenimento-staging.firebaseapp.com
FIREBASE_STAGING_APP_ID=<appId web do projeto de staging>
```

A autenticação usa Workload Identity Federation. Não armazenar arquivo JSON de
service account no repositório nem como primeira opção de secret.

## Auditoria estática

Executar antes de qualquer chamada externa:

```powershell
npm run test:media:video:staging:readiness
```

A auditoria verifica:

- Node 22;
- isolamento entre staging e produção;
- configuração Angular e bucket;
- App Check não-placeholder;
- exports do dispatcher, worker, diagnóstico e recuperação;
- contrato MP4/M4V, MOV e WebM;
- Storage Rules com reserva obrigatória;
- registro definitivo com reserva;
- TTL de despachos e DLQ;
- índice da auditoria administrativa;
- proteção contra credenciais temporárias do OIDC.

O relatório é salvo em:

```text
artifacts/video-staging/readiness.json
```

## Execução pelo GitHub Actions

Abra **Actions → Video Staging Smoke → Run workflow**.

Preencha:

```text
confirm_project = entretenimento-staging
formats        = mp4,webm,mov
cleanup        = true
```

O workflow:

1. executa a auditoria estática;
2. gera vídeos sintéticos de seis segundos com FFmpeg;
3. autentica no Google Cloud por OIDC;
4. executa o pipeline real para cada formato;
5. consulta `getVideoProcessingOperationalStatus` com claim administrativo;
6. apaga usuários, documentos e objetos efêmeros;
7. publica os relatórios como artifact por 30 dias.

## Execução local

É necessário possuir Application Default Credentials da service account de
smoke e arquivos de vídeo válidos.

Exemplo PowerShell:

```powershell
$env:VIDEO_STAGING_CONFIRM = "entretenimento-staging"
$env:VIDEO_STAGING_PROJECT_ID = "entretenimento-staging"
$env:VIDEO_STAGING_STORAGE_BUCKET = "entretenimento-staging.appspot.com"
$env:VIDEO_STAGING_AUTH_DOMAIN = "entretenimento-staging.firebaseapp.com"
$env:VIDEO_STAGING_API_KEY = "<api-key-web>"
$env:VIDEO_STAGING_APP_ID = "<app-id-web>"
$env:VIDEO_STAGING_FUNCTIONS_REGION = "us-central1"
$env:VIDEO_STAGING_FORMATS = "mp4,webm,mov"
$env:VIDEO_STAGING_MP4_PATH = "C:\temp\video-smoke.mp4"
$env:VIDEO_STAGING_WEBM_PATH = "C:\temp\video-smoke.webm"
$env:VIDEO_STAGING_MOV_PATH = "C:\temp\video-smoke.mov"
$env:VIDEO_STAGING_POSTER_PATH = "C:\temp\poster.jpg"
$env:VIDEO_STAGING_DURATION_MS = "6000"
$env:VIDEO_STAGING_CLEANUP = "true"

npm run test:media:video:staging:smoke
```

Não definir `VIDEO_STAGING_CLEANUP=false` em execução normal. Para preservar um
incidente, use temporariamente:

```text
VIDEO_STAGING_KEEP_ON_FAILURE=true
```

Depois da análise, remova manualmente o usuário, documentos e prefixo de Storage
indicados no relatório.

## Critérios de aprovação

Cada formato precisa comprovar:

- reserva `ACTIVE` antes do upload;
- upload autorizado pelas Storage Rules;
- reserva `CONSUMED` após o registro;
- job criado em `media_video_processing_jobs`;
- pelo menos um despacho técnico;
- job terminal `SUCCEEDED`;
- derivado em `users/{uid}/processed/videos/{videoId}/...`;
- MIME final `video/mp4` ou `video/webm`;
- publicação automática criada;
- moderação `PENDING_REVIEW` ou `APPROVED`;
- despacho `COMPLETED`;
- ausência do job bem-sucedido na DLQ;
- provider `READY` no painel operacional;
- limpeza dos recursos efêmeros.

Falha em qualquer item reprova o lote. Não converter falhas em warnings apenas
para liberar merge.

## O que o smoke não simula automaticamente

Continuam exigindo cenários controlados separados:

- indisponibilidade proposital do Transcoder;
- esgotamento das cinco tentativas do Cloud Tasks;
- criação deliberada de DLQ;
- cancelamento durante um job externo ativo;
- evento duplicado e atrasado injetado manualmente;
- falha de limpeza do prefixo processado;
- reprodução visual em Safari/iOS, Firefox, Chrome e Edge;
- audiência, bloqueios, idade e compatibilidade entre perfis.

Não adicionar fault injection de produção sem flag exclusiva de staging,
auditoria e garantia de que a configuração não pode ser habilitada em produção.

## Preparação da pilha de PRs

A cadeia funcional é:

```text
#68 publicação automática
  -> #69 ciclo de vida
  -> #70 reserva de quota + contrato de formatos
  -> #71 Cloud Tasks
  -> #72 painel operacional
  -> PR de homologação
```

O conteúdo funcional do #67 foi absorvido pelo #70:

- política Angular de formatos;
- testes da política;
- restrição de MIME no backend;
- restrição correspondente nas Storage Rules.

Não fazer cherry-pick cego do #67 sobre o topo da pilha. Depois de confirmar o
diff final, ele pode ser encerrado como substituído pelo #70.

Ordem de integração sugerida:

1. integrar #68 em `main`;
2. redirecionar #69 para `main` e validar novamente;
3. integrar #69;
4. redirecionar #70 para `main` e validar novamente;
5. encerrar #67 como substituído pelo #70;
6. integrar #70;
7. repetir o processo com #71, #72 e o PR de homologação.

Não integrar toda a pilha por merge commits fora de ordem. Cada redirecionamento
precisa executar novamente o Quality Gate contra a base efetiva.

## Rollback

Se o smoke falhar após deploy:

1. interromper novos testes;
2. registrar o run ID e preservar o artifact;
3. verificar painel, dispatch, job e DLQ;
4. não editar manualmente `state`, `leaseUntil`, `processingVersion` ou
   `externalJobName`;
5. usar somente as ações administrativas idempotentes já implementadas;
6. reverter Functions/Rules/Angular para a versão anterior compatível;
7. manter os índices e TTL, pois são aditivos e não expõem dados ao cliente.
