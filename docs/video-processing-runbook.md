# Processamento de vídeos

Este documento descreve a ativação e a operação do pipeline de vídeos. O código
não deve ser promovido para produção antes da validação integral em staging.

## Arquitetura

```text
upload privado
  -> registro backend
  -> media_video_processing_jobs/{jobId}
  -> trigger dispatchVideoProcessingOnJobWrite
  -> Cloud Tasks / processVideoProcessingTask
  -> Google Cloud Transcoder
  -> users/{uid}/processed/videos/{videoId}/{version}/
  -> moderação e publicação automática controlada
```

O original bruto permanece privado. Visitantes nunca recebem seu path ou URL.
Somente um derivado confirmado como MP4 ou WebM pode ser copiado para o
namespace publicado.

A task não confia no evento que a originou. Antes de executar qualquer ação,
recarrega o job e confirma:

- `jobId`;
- `processingVersion`;
- estado atual;
- vencimento de retry ou lease;
- existência do vídeo privado;
- vínculo do arquivo original.

Entregas duplicadas, atrasadas ou fora de ordem tornam-se operações idempotentes
ou no-op seguras.

## Modos de despacho

```text
SUBMIT               QUEUED -> envia ao Google Transcoder
RECOVER_SUBMISSION   SUBMITTING -> procura submissão ambígua pela versão
RECONCILE            PROCESSING -> consulta e finaliza o estado do provedor
CANCEL               CANCEL_REQUESTED -> cancela e limpa os derivados
```

Cada despacho possui ID determinístico derivado de:

```text
jobId + processingVersion + modo + vencimento
```

O registro técnico fica em:

```text
media_video_processing_dispatches/{dispatchId}
```

Estados possíveis:

```text
ENQUEUEING
ENQUEUED
COMPLETED
FAILED
EMULATOR_SKIPPED
```

Falhas terminais do job são projetadas, sem dados sensíveis do arquivo, em:

```text
media_video_processing_dead_letters/{deadLetterId}
```

A DLQ não substitui o documento canônico do job. Ela oferece uma visão estável
para diagnóstico, alertas e recuperação administrativa.

## Retenção técnica com Firestore TTL

Cada documento técnico recebe um campo `cleanupAfter` do tipo Timestamp:

```text
despachos:       7 dias após execução ou vencimento agendado
falhas na DLQ:  30 dias após o registro da falha
```

Ativar as políticas TTL em cada ambiente:

```powershell
gcloud firestore fields ttls update cleanupAfter `
  --collection-group=media_video_processing_dispatches `
  --enable-ttl `
  --project=<PROJECT_ID>

gcloud firestore fields ttls update cleanupAfter `
  --collection-group=media_video_processing_dead_letters `
  --enable-ttl `
  --project=<PROJECT_ID>
```

A exclusão TTL não é imediata. O Firestore normalmente remove documentos
expirados em até 24 horas. Não criar scheduler paralelo para apagar essas duas
coleções enquanto as políticas estiverem ativas.

## Cloud Tasks

A função de fila é:

```text
processVideoProcessingTask
```

Configuração aplicada no código:

```text
máximo de tentativas:       5
backoff mínimo:             30 segundos
backoff máximo:             15 minutos
janela máxima de retry:     6 horas
concorrência máxima:        4 tasks
limite de despacho:         2 tasks/segundo
deadline por tentativa:     540 segundos
memória:                    512 MiB
```

O trigger `dispatchVideoProcessingOnJobWrite` cria uma task quando o estado do
job exige trabalho. `task-already-exists` é tratado como entrega idempotente.

## Schedulers de recuperação

Os nomes públicos existentes foram mantidos:

```text
submitQueuedVideoProcessing
reconcileVideoProcessing
cleanupCancelledVideoProcessing
```

Eles não são mais o caminho normal. Executam a cada 60 minutos apenas como rede
de segurança para:

- falha transitória ao criar a task;
- indisponibilidade prolongada do Cloud Tasks;
- job legado criado antes do dispatcher;
- inconsistência operacional que exija reconciliação posterior.

Não reduzir novamente esse intervalo para cinco minutos como solução de
latência. A latência normal deve ser resolvida pelo dispatcher orientado a
eventos.

## Pré-requisitos do projeto Google Cloud

1. Confirmar faturamento ativo no projeto de staging.
2. Habilitar as APIs:

```powershell
gcloud services enable transcoder.googleapis.com --project=<PROJECT_ID>
gcloud services enable cloudtasks.googleapis.com --project=<PROJECT_ID>
```

3. Identificar a service account efetivamente usada pelas Functions de segunda
geração. Não presumir o endereço; conferir a configuração implantada.
4. Conceder a essa identidade as permissões mínimas para criar e consultar jobs
do Transcoder. O papel predefinido usado atualmente é:

```text
roles/transcoder.admin
```

5. Conceder à identidade que enfileira as tasks:

```text
roles/cloudtasks.enqueuer
```

6. Garantir que a identidade usada pela task possa invocar
`processVideoProcessingTask`:

```text
roles/cloudfunctions.invoker
```

7. Quando a task utilizar uma service account diferente da identidade que a
enfileira, conceder também permissão para atuar como essa service account.
8. Confirmar que o service agent do Transcoder possui acesso mínimo aos objetos
do bucket privado de mídia.

Exemplo de binding do invocador, substituindo os placeholders pela identidade
real do ambiente:

```powershell
gcloud functions add-iam-policy-binding processVideoProcessingTask `
  --gen2 `
  --region=<REGION> `
  --member=serviceAccount:<TASK_SERVICE_ACCOUNT> `
  --role=roles/cloudfunctions.invoker `
  --project=<PROJECT_ID>
```

## Variáveis opcionais do Transcoder

```text
VIDEO_TRANSCODER_LOCATION=us-central1
VIDEO_TRANSCODER_TEMPLATE_ID=preset/web-hd
VIDEO_TRANSCODER_ALLOW_LIVE_PROBE=false
```

Sem configuração explícita, o código utiliza a região canônica das Functions e
o preset oficial `preset/web-hd`.

`VIDEO_TRANSCODER_ALLOW_LIVE_PROBE` deve permanecer ausente ou `false` durante o
uso normal dos Emulators. Quando estiver desabilitada, a tela administrativa
não consulta o projeto real e apresenta o estado `Emulator`.

## Firebase Emulator Suite

No Emulator, o dispatcher registra o despacho como `EMULATOR_SKIPPED` e não
chama o Cloud Tasks real. O processamento local existente continua responsável
por concluir MP4 e WebM quando:

```text
FUNCTIONS_EMULATOR=true
MEDIA_EMULATOR_AUTO_PROCESS_VIDEOS=true
```

MOV continua exigindo o Transcoder real e recebe erro explícito no ambiente
local. Nunca habilitar acesso involuntário ao projeto real durante testes.

## Diagnóstico administrativo

A rota administrativa apresenta um painel atualizado periodicamente por meio de:

```text
getVideoProcessingOperationalStatus
```

A callable é restrita a administradores e executa somente operações de leitura:

- solicita token com a identidade das Functions;
- lista no máximo um job do Transcoder para validar API, região e IAM;
- contabiliza jobs persistidos por estado;
- calcula a idade aproximada do backlog ativo;
- sinaliza jobs possivelmente atrasados.

Além do painel existente, verificar em incidentes:

```text
media_video_processing_dispatches
media_video_processing_dead_letters
media_video_processing_jobs
```

Um despacho `FAILED` indica problema na criação ou execução da task. Um job
`FAILED` na DLQ indica falha terminal do domínio de processamento.

## Recuperação administrativa

A lista operacional é obtida por:

```text
listVideoProcessingRecoveryJobs
```

A intervenção é executada somente por:

```text
recoverVideoProcessingJob
```

Cada ação exige justificativa objetiva, identificador idempotente da operação e
claim administrativo. A decisão é registrada em `admin_logs`.

Ações disponíveis:

```text
RETRY_FAILED    cria uma nova versão para um job FAILED
RECHECK_STALE   libera fila ou lease expirado para reconciliação segura
CANCEL_ACTIVE   solicita cancelamento e limpeza técnica assíncrona
```

`RETRY_FAILED` nunca reutiliza o mesmo prefixo de saída. A versão anterior entra
em `media_video_processing_output_cleanup_jobs` e é removida pela rotina
`cleanupRetriedVideoProcessingOutputs`.

Não alterar manualmente `state`, `leaseUntil`, `externalJobName`, `nextAttemptAt`
ou `outputPrefix`. Uma alteração administrativa válida do job gera
automaticamente um novo despacho orientado ao estado persistido.

## Estados persistidos

```text
QUEUED
SUBMITTING
PROCESSING
SUCCEEDED
FAILED
CANCEL_REQUESTED
CANCELLED
```

O documento privado apresenta ao usuário os estados reduzidos:

```text
queued
processing
ready
failed
```

## Critérios antes do deploy

- lint, build e testes de Functions aprovados;
- policy de quota realmente executada no comando `npm test`;
- policy de despacho executada no comando `npm test`;
- build e testes Angular aprovados;
- regras de Storage aprovadas;
- Cloud Tasks API habilitada em staging;
- Transcoder API habilitada em staging;
- políticas TTL `cleanupAfter` ativas nas duas coleções técnicas;
- IAM de enqueue e invoke validado com a identidade real;
- `processVideoProcessingTask` implantada antes de aceitar uploads;
- task criada imediatamente após um job `QUEUED`;
- entrega duplicada testada sem duplicar job do Transcoder;
- evento atrasado testado sem regressão do estado;
- falha transitória testada com recuperação de lease;
- reprocessamento `FAILED` testado com nova versão;
- cancelamento testado com retry e limpeza do prefixo;
- scheduler horário testado como fallback, não como caminho normal;
- DLQ validada com uma falha terminal controlada;
- upload de MP4, WebM e MOV testado;
- vídeo com menos de cinco segundos rejeitado;
- exclusão durante processamento testada;
- derivado reproduzível em Chrome, Firefox, Safari e Edge;
- publicação bloqueada enquanto não houver `processedStoragePath`;
- moderação aprovada e rejeitada testadas;
- custos e quotas de Cloud Tasks, Firestore TTL e Transcoder acompanhados.

## Observação de segurança

Processamento técnico não substitui moderação de conteúdo. Não habilitar
aprovação automática irrestrita em produção sem política explícita, auditoria e
controles de segurança compatíveis com a plataforma.
