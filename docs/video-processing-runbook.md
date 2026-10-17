# Processamento de vídeos

Este documento descreve a ativação operacional do pipeline de vídeos. O código
não deve ser publicado antes da validação no ambiente de staging.

## Arquitetura

```text
upload protegido
  -> registro backend
  -> media_video_processing_jobs
  -> Google Cloud Transcoder
  -> users/{uid}/processed/videos/{videoId}/{version}/
  -> cópia publicada controlada
```

O arquivo-fonte bruto permanece protegido. Visitantes nunca recebem seu path ou
URL. Somente um derivado confirmado como MP4 ou WebM pode ser copiado para o
namespace publicado.

A conclusão técnica do processamento publica o vídeo sem exigir aprovação humana
prévia. Moderação de conteúdo é um fluxo separado e orientado por denúncias:
denúncias válidas entram em `moderation_reports`; casos que atingem os critérios
de segurança podem ser colocados em quarentena enquanto a moderação decide entre
manter ou remover o conteúdo.

## Pré-requisitos do projeto Google Cloud

1. Confirmar faturamento ativo no projeto de staging.
2. Habilitar a Transcoder API:

```powershell
gcloud services enable transcoder.googleapis.com --project=<PROJECT_ID>
```

3. Identificar a service account efetivamente usada pelas Functions de segunda
geração. Não presumir o endereço; conferir a configuração implantada.
4. Conceder a essa service account permissões para criar, listar, consultar e
excluir jobs do Transcoder. O papel predefinido que cobre essas operações é:

```text
roles/transcoder.admin
```

5. Confirmar que o service agent do Transcoder possui acesso aos objetos do
bucket. Em projetos sem restrição adicional, esse acesso é provisionado pelo
Google ao criar o primeiro job. Em buckets endurecidos, conceder ao service
agent apenas o acesso necessário ao bucket de mídia.

## Variáveis opcionais

```text
VIDEO_TRANSCODER_LOCATION=us-central1
VIDEO_TRANSCODER_TEMPLATE_ID=preset/web-hd
```

Sem configuração explícita, o código utiliza a região canônica das Functions e
o preset oficial `preset/web-hd`.

O Functions Emulator nunca consulta a API real do Transcoder, mesmo se houver
credenciais disponíveis ou flags legadas no ambiente. A tela administrativa
apresenta o estado `Emulator`, e operações de criação, consulta e exclusão
externas são recusadas pelo guard central antes de obter tokens.
O processamento local de MP4/WebM permanece independente desse acesso.

## Diagnóstico administrativo

A rota administrativa de vídeos apresenta um painel de diagnóstico atualizado a
cada minuto. O painel consulta a callable:

```text
getVideoProcessingOperationalStatus
```

A callable é restrita a administradores e executa somente operações de leitura:

- solicita um token com a identidade das Functions;
- lista no máximo um job do Transcoder para validar API, região e IAM;
- contabiliza os jobs persistidos por estado;
- calcula a idade aproximada do backlog ativo;
- sinaliza uma amostra de jobs possivelmente atrasados.

Estados do painel:

```text
Operacional      API e IAM responderam corretamente
Ação necessária  API, região, projeto ou permissões falharam
Emulator         consulta externa intencionalmente ignorada
```

O diagnóstico não cria, altera nem exclui jobs do Transcoder. Um estado
`Operacional` confirma conectividade e permissão de listagem, mas não substitui
o teste de processamento completo com um arquivo real.

## Recuperação administrativa

A mesma tela apresenta jobs com falha, atraso ou cancelamento pendente. A lista é
obtida por:

```text
listVideoProcessingRecoveryJobs
```

A intervenção é executada somente pela callable:

```text
recoverVideoProcessingJob
```

Cada ação exige justificativa objetiva, identificador idempotente da operação e
claim administrativo. A decisão é registrada em `admin_logs`.

Ações disponíveis:

```text
RETRY_FAILED    cria uma nova versão de processamento para um job FAILED
RECHECK_STALE       libera fila ou lease expirado para reconciliação segura
RECHECK_UNCONFIRMED libera somente nova consulta para submissão sem confirmação
RECHECK_PROVIDER    reconfere GET do job externo da versão sem novo POST
CANCEL_ACTIVE       solicita cancelamento e limpeza técnica assíncrona
```

`RETRY_FAILED` nunca reutiliza o mesmo prefixo de saída. A versão anterior entra
na coleção técnica `media_video_processing_output_cleanup_jobs` e é removida
pela rotina `cleanupRetriedVideoProcessingOutputs`.

Uma submissão com `SUBMISSION_UNCONFIRMED` não é um job `FAILED`
comprovado: a API pode ter criado o recurso mesmo que a resposta ao POST
não tenha chegado. Após três consultas negativas, a fila deixa de autorizar
novas verificações automáticas. A administração pode solicitar
`RECHECK_UNCONFIRMED` com justificativa; isso consulta o provedor e **nunca
cria outro job**. A operação é auditada em `admin_logs`.
Jobs legados `FAILED` com `SUBMISSION_NOT_FOUND` ou código de submissão
não confirmada não oferecem `RETRY_FAILED`. Um resultado vazio de `jobs.list`
não comprova a inexistência de um job remoto: a API pode ter recebido a
requisição anterior e ainda não estar refletindo esse recurso nas buscas.

Procedimento para revisão manual:
1. Conferir projeto, região, versão de processamento e filtros utilizados.
2. Consultar o Transcoder novamente, com paginação completa, sem criar jobs.
3. Tratar retorno vazio, erro, paginação incompleta ou duplicidade como
   `NÃO CONFIRMADO`, jamais como autorização automática de reenvio.
4. Se houver job identificado, preservar seu nome no registro correto da
   versão e seguir o fluxo de reconciliação ou cancelamento.
5. Sem confirmação suficiente, manter o job bloqueado e registrar a análise,
   sem alterar diretamente `state` ou `externalJobName`.
6. Uma eventual autorização de nova tentativa exige procedimento separado,
   com avaliação de custo e evidência independente, transação versionada,
   justificativa e histórico; **esse desbloqueio ainda não foi habilitado**.

Cancelamentos com `CANCELLATION_UNCONFIRMED` também preservam o rastreamento
até que a identidade do recurso externo seja confirmada.

### Fila técnica de cancelamentos

O scheduler `cleanupCancelledVideoProcessing` executa a cada 30 minutos e
seleciona apenas `CANCEL_REQUESTED` com `nextAttemptAt <= now`, ordenando
pelo menor vencimento antes de limitar o lote a 20 documentos. Usa o índice
composto canônico `state + nextAttemptAt`, sem varrer a coleção inteira.

Cada documento recebe uma reserva transacional de 25 minutos antes das
chamadas externas. Outra execução não deve assumir a mesma reserva. Falhas de
limpeza são reagendadas para 30 minutos, 2 horas e, a partir da terceira,
24 horas. `cancellationCleanupAttempts` é independente das tentativas
de criação de jobs, e `cancellationReviewRequired` é ativado após três
falhas ou imediatamente quando o job externo não puder ser confirmado.
O alerta permanece marcado durante falhas posteriores e **não autoriza**
uma nova submissão.

O inventário somente de leitura `npm run inspect:video-jobs:emu` informa
cancelamentos vencidos, adiados, sem data válida e com revisão necessária.
O indicador `cancellationEvidence` resume apenas metadados persistidos:
`providerTracking` distingue ausência de submissão registrada, submissão
possivelmente externa e nome externo presente; `cleanupHistory` separa
falhas contadas, contador zerado e documentos sem contador legado;
`lastError` distingue consulta externa inconclusiva de outros estados.
Nenhum desses contadores comprova execução do scheduler, existência do job no
Transcoder ou exclusão de arquivos. O Firestore Emulator isolado não dispara
Cloud Scheduler automaticamente. A ferramenta não consulta APIs externas e
não revela nomes, caminhos ou identificadores privados.

O contador `overdue24h` identifica cancelamentos há mais de 24 horas
cujo `nextAttemptAt` já venceu. Ele é um **alerta operacional** independente
de `reviewRequired`, que continua reservado a falha externa ou repetição
de tentativas. O painel administrativo mantém essa distinção e não habilita
reenvio nem exclusão por causa do atraso.
Um documento legado sem `nextAttemptAt` pode ficar fora da consulta;
qualquer reparo requer verificação versionada e execução separada.
Não excluir manualmente cancelamentos com identidade externa incerta.

O cancelamento usa um núcleo testável com portas injetadas. O teste isolado
simula resposta de exclusão bem-sucedida e HTTP 404 (ambas permitem concluir
a limpeza), erro HTTP 503 ou perda de conexão (preserva o registro e agenda
nova tentativa), identificador externo inválido (falha fechada), resposta
incerta de submissão (não apaga nem reenvia) e mudança de versão (não altera
a tentativa nova). O transporte simulado não possui saída de rede real.

A interface administrativa deve distinguir explicitamente conectividade
com a API do Transcoder de execução efetiva do scheduler. O badge
`Transcoder acessível` **não** equivale a saúde do processamento.
O card de cancelamentos utiliza apenas a amostra ativa já consultada pelo
diagnóstico: mostra vencidos, atrasados mais de 24 horas, campos de agenda
ausentes/inválidos e cobertura parcial. Não acrescenta leituras nem gravações
de documentos. O estado do scheduler permanece `UNVERIFIED` até que exista
evidência de execução verificada por outro mecanismo; contadores zerados,
inclusive de amostra parcial, não provam saúde operacional.

### Observabilidade consolidada dos schedulers (1C2-A3b2b2c7)

Três rotinas mantêm evidência agregada em
`media_video_scheduler_execution/{scheduler}`: submissão de vídeos,
reconciliação/limpeza terminal e cancelamento. Cada ciclo concluído (ou
falhado) persiste, em **um único documento por scheduler**, o último resultado
por ordem de conclusão. Uma transação impede que uma execução antiga sobrescreva
a conclusão mais recente. A gravação é *best effort*: falha de telemetria
nunca autoriza reenvio, exclusão, mudança de estado ou supressão de erro do
processamento. Não há novos agendamentos, consultas ao Transcoder nem varreduras
de coleções para telemetria.

`getVideoProcessingOperationalStatus` lê no máximo esses três documentos.
O painel exibe estados **somente da última execução registrada**:

- `OPERATIONAL`: uma execução recente terminou sem alertas identificados;
- `DEGRADED`: uma execução recente terminou com itens pendentes, erros
  isolados ou limite do lote alcançado;
- `FAILED`: a última execução recente terminou com exceção;
- `UNVERIFIED`: registro ausente, inválido ou antigo (acima de 25 minutos
  para ciclos de 5 minutos e de 100 minutos para cancelamentos).

Esses estados **não comprovam** que o Cloud Scheduler executou em todos os
horários nem que todos os jobs estão íntegros. Ausência de registro não é
classificada automaticamente como falha; há que conferir Cloud Scheduler,
Cloud Run e logs de produção. A leitura administrativa é restrita por
autenticação, App Check e rate limit e não permite ações de descarte.

`VIDEO_MEDIA_SCHEDULER_STARTED`, `VIDEO_MEDIA_SCHEDULER_FINISHED` e
`VIDEO_MEDIA_SCHEDULER_FAILED` usam `cycleId`, nome de scheduler, fase,
duração e contadores agregados, sem UID, IDs de vídeo, nomes de jobs, caminhos
ou mensagens de exceção. Os eventos legados
`VIDEO_CANCELLATION_CYCLE_STARTED/FINISHED/FAILED` continuam preservados;
o cancelamento grava sua conclusão agregada no mesmo mecanismo.
A reconciliação inclui resumo da limpeza terminal, mas nenhuma métrica
autoriza reprocessamento ou exclusão. Operações com falhas internas tratadas
pelo próprio fluxo podem não ser contadas como falhas isoladas: interpretar
`attempted`/ `claimed` como volume, nunca como número de transcodificações
bem-sucedidas. Um lote cheio indica possível saturação, não erro do provedor.

### Auditoria offline do scheduler por logs exportados

A analise de logs pode ser feita sob demanda sem novas permissoes nas Functions,
sem chamadas adicionais do painel e sem alterar o Firestore. Depois do deploy
da versao que emite os eventos, exporte logs com permissao de leitura do projeto
**explicitamente selecionado** no PowerShell:

```powershell
$filter = 'jsonPayload.event=("VIDEO_CANCELLATION_CYCLE_STARTED" OR "VIDEO_CANCELLATION_CYCLE_FINISHED" OR "VIDEO_CANCELLATION_CYCLE_FAILED")'
$arquivo = Join-Path $env:TEMP 'video-cancellation-logs.json'
gcloud logging read $filter --project=SEU_PROJECT_ID --freshness=48h --limit=500 --format=json |
  Set-Content -Encoding UTF8 $arquivo
if ($LASTEXITCODE -ne 0) { throw 'Leitura do Cloud Logging falhou' }
node scripts/dev/inspect-video-cancellation-logs.mjs $arquivo
```

O comando Node analisa somente o arquivo JSON local (maximo 8 MiB e 2000
entradas). Aceita exports JSON do Cloud Logging e emite exclusivamente
contagens, datas, estados permitidos e duracao. Nao acessa a rede nem
devolve identificadores, conteudo de erros ou nomes de jobs. Nao compartilhe
a exportacao bruta, pois metadados externos podem conter informacoes privadas.

O resultado `EXPORTED_LOGS_ONLY` e `NOT_VERIFIED` e deliberado: o par de
eventos STARTED/FINISHED comprova que o codigo os emitiu, mas nao garante
que o agendamento disparou em todos os horarios. Eventos faltantes podem
decorrer de retencao do Cloud Logging, limites da consulta, filtros ou versao
ainda nao implantada. Confira Cloud Scheduler e Cloud Run antes de atribuir
uma falha de execucao ao scheduler. A ferramenta tambem identifica ciclos
sem evento terminal, eventos terminais sem inicio e exportacoes possivelmente
truncadas, sem classificacoes precipitadas.

### Logs de execução do scheduler

Cada execução agendada produz dois eventos estruturados correlacionados pelo
`cycleId`, sem gravar documentos novos no Firestore:

- `VIDEO_CANCELLATION_CYCLE_STARTED`: tentativa iniciada, mesmo quando a
  consulta ao Firestore falha;
- `VIDEO_CANCELLATION_CYCLE_FINISHED`: execução terminada, com `selected`,
  `claimed`, `invalid`, `claimSkipped`, `batchLimitReached`,
  `completed`, `retryScheduled`, `unconfirmed`, `replaced`,
  `taskRejected` e `durationMs`;
- `VIDEO_CANCELLATION_CYCLE_FAILED`: falha de consulta ou reserva, com a
  fase `QUERY`, `CLAIM` ou `EXECUTE`; a exceção é relançada para o
  agendador, não convertida em execução bem-sucedida.

Os logs não incluem UID, ID do vídeo, prefixo do Storage, nome externo do job
nem mensagens brutas de erro. `ATTENTION` significa falha registrada,
submissão não confirmada ou documento inválido, **não** falha de todos os
cancelamentos do lote. `batchLimitReached` sinaliza lote cheio, sem
significar que houve erro. A contagem de `taskRejected` identifica falhas
que escaparam à rotina individual de retry.

Para investigar em ambiente cloud, filtrar os logs da Function
`cleanupCancelledVideoProcessing` pelos eventos acima e conferir a
periodicidade esperada de 30 minutos e os pares de `cycleId`. Ausência de
um evento não comprova que a API externa foi ou não chamada: conferir também
Cloud Scheduler, implantação efetiva e retenção do Cloud Logging.

No Firestore Emulator da porta `8080`, nenhuma rotina Cloud Scheduler dispara
automaticamente. Portanto, o documento cancelado no snapshot pode permanecer
vencido até uma execução explicitamente preparada e segura. Não usar os logs
do GitHub Actions como substituto da execução em cloud.

Se um documento `CANCEL_REQUESTED` não puder ser validado, o scheduler
**preserva o registro** e gera alerta agregado, sem exclusão automática.
Igualmente, o nome de um job externo malformado causa erro de limpeza:
não deve ser interpretado como exclusão bem-sucedida. O retry permanece
sujeito aos mesmos limites e à revisão administrativa.

Não alterar manualmente `state`, `leaseUntil`, `externalJobName` ou
`outputPrefix` no Firestore. Em jobs `SUBMITTING`, a revalidação não cria outro
job imediatamente: o reconciliador procura primeiro o job existente pela label
de versão. Jobs `PROCESSING` devem ser cancelados, não reenfileirados às cegas.


### Revisão administrativa de limpeza temporária terminal

A fila `media_video_terminal_temp_cleanup_jobs` guarda snapshots imutáveis por
`jobId + processingVersion`. Falhas persistentes (oito tentativas) e
conflitos de proveniência levam a `state=review` e deixam de ser agendados.
A tela administrativa consulta `listVideoTerminalTemporaryCleanupReviews`;
o contador completo é independente da amostra limitada a 50 registros.

Somente um administrador com App Check pode solicitar
`recheckVideoTerminalTemporaryCleanup`, com justificativa, `operationId`
idempotente, versão e `updatedAt` esperado. Uma transação confirma
`state=review`, ausência de lease e o snapshot terminal da versão exata,
incluindo identidade do job, prova terminal do provedor e validação da
geração/proveniência do input imutável. Sem snapshot recuperável ou com
identidade inválida, a revisão permanece bloqueada; nenhum estado de
processamento, publicação ou cancelamento é alterado.

A reconferência **somente** reabre a mesma fila; não realiza GET/POST/DELETE
no Transcoder nem remove arquivos do Storage. O scheduler existente valida
novamente a proveniência e a geração dos objetos GCS, com precondição
`ifGenerationMatch` e reserva transacional, antes de eventual remoção.
Conflitos voltam para `review`, sem autorização de descarte forçado.
A decisão é auditada atomicamente em `admin_logs`. Nunca reconstruir
snapshots de uma versão substituída ou editar manualmente documentos.

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

O documento do vídeo apresenta ao usuário os estados reduzidos:

```text
queued
processing
ready
failed
```

## Critérios antes do deploy

- lint e build de Functions aprovados;
- build Angular aprovado;
- regras de Storage revisadas;
- API e IAM configurados somente em staging;
- painel administrativo no estado `Operacional` em staging;
- upload de MP4, WebM e MOV testado;
- vídeo com menos de cinco segundos rejeitado;
- falha transitória testada sem duplicar job;
- reprocessamento de job `FAILED` testado com uma nova versão;
- revalidação de `SUBMITTING` testada sem criar job duplicado;
- cancelamento administrativo testado com limpeza do prefixo;
- exclusão durante processamento testada;
- derivado confirmado como reproduzível em Chrome, Firefox, Safari e Edge;
- publicação bloqueada enquanto não houver `processedStoragePath`;
- publicação automática testada sem fila de aprovação humana;
- denúncia testada com entrada em `moderation_reports`;
- quarentena por risco e decisões `KEEP`/`REMOVE` testadas;
- custos e quotas do Transcoder acompanhados.

## Observação de segurança

Processamento técnico e moderação são responsabilidades distintas. O vídeo que
passa pelo processamento normal é publicado; denúncias e sinais de risco são
tratados pelo fluxo de moderação, que pode manter, colocar em quarentena ou
remover conteúdo conforme a decisão registrada.