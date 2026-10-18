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

A rota administrativa de vídeos apresenta um painel com consulta inicial,
atualização manual, atualização ao voltar para uma aba visível e atualização
periódica a cada **cinco minutos**, apenas com a aba visível. As três seções
compartilham um único gatilho de atualização; não há polling enquanto a aba
está oculta. Uma atualização ainda em andamento pode consumir recursos mesmo
após a aba ficar oculta. O painel consulta a callable:

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

O diagnóstico não cria, altera nem exclui jobs do Transcoder. A indicação
`Transcoder acessível` confirma apenas conectividade e permissão de listagem.
O resumo **Prioridade operacional** combina o estado do provedor com as
execuções observadas dos schedulers, resultados de jobs, amostras de backlog,
incidentes preservados e confiabilidade da telemetria. Trata amostra parcial,
leitura indisponível, histórico antigo e jobs terminais FAILED como **verificação**
sem presumir incidente em andamento. Falha recente de scheduler, alerta de jobs,
indisponibilidade do provedor e atrasos observados demandam investigação.
A indicação `Sem alertas nos dados consultados` não certifica saúde completa,
nem execução de todos os agendamentos. O resumo é somente leitura e nunca
autoriza retry, cancelamento ou exclusão.

Erros da callable de diagnóstico, consulta de limpeza temporária e reconferência
usam, respectivamente, os motivos canônicos `video_operational_diagnostic_load_failed`,
`video_terminal_cleanup_queue_load_failed` e
`video_terminal_cleanup_action_failed`. Os dois primeiros são diagnósticos
inline; o terceiro gera feedback de ação. Não utilizar mensagens de upload
ou biblioteca para essas operações. Logs de falhas do diagnóstico não devem
incluir exceções brutas ou identificadores pessoais.

### Paginação das filas administrativas (1C2-A3b2b2c17)

As filas de recuperação e limpeza terminal agora aceitam cursores determinísticos
e páginas limitadas. Os cursores avançam na ordem dos IDs dos documentos,
com os índices Firestore já existentes e sem novas varreduras integrais.
A recuperação percorre os cinco estados acionáveis independentemente,
consumindo todos os documentos retornados antes de avançar cada posição.
A limpeza terminal percorre apenas registros de revisão. Há lookahead
de um documento por estado para indicar se existem mais páginas.

**Limite importante:** a prioridade e a antiguidade são ordenadas apenas
entre os documentos retornados em cada página, nunca globalmente.
A primeira página não deve ser descrita como contendo o job mais crítico
ou mais antigo de toda a coleção. Registros legados sem `updatedAt`
continuam elegíveis à travessia por ID. Cursor não é snapshot imutável;
mudanças de estado e exclusões entre páginas exigem uma atualização.

Para limite de 30, a recuperação lê até 35 documentos por página,
sem consulta separada por `providerPollReviewRequired`: seus alertas
já são representados nas propriedades dos jobs acionáveis.
A limpeza terminal lê até 31 documentos e preserva a contagem agregada.
Os botões administrativos `Carregar mais jobs` e `Carregar mais revisões`
preservam os cartões existentes, deduplicam IDs após mudanças concorrentes
e impedem consultas de páginas sobrepostas. Uma atualização do diagnóstico
reinicia a paginação e descarta os cursores antigos.

O avanço entre páginas deve ser explícito e submetido aos mesmos limites
de autenticação, App Check e rate limit que a consulta inicial.
Nenhum cursor autoriza recovery, reenvio ou exclusão.

### Ordenação global: preparação segura (1C2-A3b2b2c18)

Os índices `media_video_processing_jobs(state, updatedAt, __name__)`,
`media_video_processing_jobs(state, createdAt, __name__)` e
`media_video_terminal_temp_cleanup_jobs(state, updatedAt, __name__)`
foram **declarados no repositório, mas não implantados**. Nenhuma callable
passou a consultá-los: a navegação por ID da c17 continua sendo a fonte
segura para cobrir registros legados. O simples merge na `main` não
assegura que os índices existam em produção.

A recuperação agora informa `timestampEvidence` por item:
`UPDATED` (timestamp validado), `CREATED_FALLBACK` (estimativa a
partir da criação) ou `UNVERIFIED` (sem evidência temporal).
O painel nunca deve chamar um timestamp ausente de "dentro da janela"
ou interpretar `0` como a idade real do registro. Essa é evidência
**da página observada**, não atestado de cobertura global.

Portões obrigatórios **antes** de habilitar uma consulta ordenada global:
1. Confirmar a implantação e o estado `READY` dos índices no projeto/região.
2. Auditar documentos legados sem timestamps válidos e preparar migração
   segura, idempotente e verificável, sem alterar estado, versão ou arquivos.
3. Demonstrar que flags críticas de cancelamento, submissão inconclusiva e
   falha do provedor não ficam escondidas em páginas distantes. Ordenação
   somente por `updatedAt` **não** garante prioridade global por gravidade.
4. Validar cursores com empates, mutação e exclusão entre páginas, bem
   como o orçamento máximo de leituras por abertura e por atualização.
5. Somente após essas provas, autorizar separadamente a mudança do plano
   de consultas; sem deploy ou autorização, a estratégia atual permanece.

A etapa c18 não introduz varreduras, escrita de backfill, novo polling
ou operações de Transcoder. A fila continua explicitamente classificada
como **ordem dentro da página**, não como prioridade global.

### Auditoria progressiva de cobertura (1C2-A3b2b2c18b)

O endpoint de recuperação e o de revisão de limpeza terminal agora retornam um
objeto `audit` com `scope: PAGE_ONLY`, calculado **exclusivamente sobre os
documentos já consumidos pela página**. Nenhuma consulta adicional, nova
varredura, escrita, solicitação ao Transcoder ou índice novo é utilizado.

**Recuperação:** `observed`, `invalidDocuments`, `updatedTimestamp`,
`createdFallback`, `unverifiedTimestamp`, `failed`, `stale`,
`providerReview`, `providerPollReview`, `overdueCancellation` e
`unconfirmedSubmission`. Os indicadores de risco podem se sobrepor.
Registros inválidos continuam fora dos cartões, mas são contabilizados.
**Revisões terminais:** `observed`, `unverifiedTimestamp`, `blocked`
e `recheckable`. Timestamp futuro é inválido para idade operacional.
O bloqueio para reconferir continua governado pela política de segurança.

Os painéis somam as observações de páginas carregadas. O total refere-se a
**observações**, não a IDs únicos, pois a concorrência pode levar um job a
ser visto em estados distintos. A tela deduplica cartões; as contagens não
demonstram ausência de omissões. Mesmo quando `hasMore=false`, não afirmar
snapshot, completude sob concorrência ou classificação de prioridade global.
Atualizações periódicas reiniciam os cursores e a auditoria.

Para investigação manual, percorra páginas com botão de carregamento e
reavalie após novas mutações. Jobs fora dos cinco estados acionáveis
não integram esse inventário. A contagem global do diagnóstico de status
é outra fonte e não deve ser confundida com cobertura do inventário.
Os limites seguem sendo até 35 documentos lidos por página na recuperação
com `limit=30` (30 consumidos, até 5 de lookahead), e até 31 documentos
+ uma agregação `count()` na revisão terminal com `limit=30`.
Não habilitar paginação automática.

A ativação global continua **bloqueada** até verificar índices `READY` no
Google Cloud, cobertura de timestamps legados e política de prioridade
por gravidade. Para conferir índices sem deploy, executar leitura autorizada
`gcloud firestore indexes composite list --project=PROJECT_ID --database='(default)'`,
conferir campos, ordenação e estado `READY`; o simples
`firestore.indexes.json` no GitHub não valida implantação. Nenhuma migração
retroativa dos dados foi realizada na c18b.

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

### Qualidade real dos jobs, distinta da execução (1C2-A3b2b2c8)

A conclusão de uma invocação do Scheduler não implica sucesso dos jobs. A
instrumentação contabiliza, **sem consultas novas ao Transcoder**, somente os
resultados efetivamente observados nas funções de submissão, recuperação
de submissões e reconciliação:

- Submissões confirmadas no documento atual, falhas de POST aplicadas ao estado
  atual, retentativas e pré-verificações adiadas;
- Buscas por submissão ambígua que encontraram um job externo e foram
  persistidas, negativas ainda não confirmadas, e erros de consulta já
  tratados com version fencing;
- Consultas GET que retornaram estado não terminal, SUCCEEDED ou FAILED,
  erros do provedor que resultaram em backoff, e necessidade de revisão
  administrativa após falhas consecutivas;
- Limpeza terminal concluída, reagendada, bloqueada para revisão ou ignorada
  por alteração concorrente, com suas métricas de geração e proveniência
  preservadas pelo executor anterior.

Na tela administrativa, o **estado da execução** (`EXECUTED`, `FAILED`,
`UNVERIFIED`) agora é distinto da **qualidade dos jobs observados**
(`NO_ALERTS_OBSERVED`, `ATTENTION`, `UNVERIFIED`). Uma execução que
terminou sem rejeitar promises pode, corretamente, ter jobs exigindo atenção
quando houve erro de consulta, confirmação ambígua, backoff ou revisão.
Uma execução `FAILED` não produz uma conclusão agregada confiável dos jobs.

O campo `evidenceVersion: 2` identifica registros criados com as novas
métricas. Documentos anteriores não são tomados como evidência de ausência
de erros; o diagnóstico de jobs permanece `UNVERIFIED` até um novo ciclo.
Registros antigos ou ausentes também não provam que um agendamento falhou.
O painel não autoriza ações automáticas baseado nesses contadores.

`providerSucceededObserved` e `providerFailedObserved` significam
**resposta terminal do provedor observada**, não confirmação de publicação
ou alteração do estado persistido. `submissionConfirmed` exige que o
resultado da transação atual tenha aplicado a identidade externa ao
processamento vigente. Mudanças de versão/cancelamento são registradas
separadamente como substituição, sem contar como erro de Transcoder.
Os contadores são relativos **somente aos lotes selecionados no ciclo**;
fila total e atrasos continuam vindo do diagnóstico anterior, sujeito a
amostragem e limites. Não inferir sucesso de jobs fora desses lotes.

A instrumentação é best effort, não altera leases, estado, reprocessamento,
cancelamento, precondições de geração ou exclusões GCS e não adiciona
permissões, jobs agendados, flags nem varreduras de coleções. A documentação
se refere ao código da `main`, sem presumir implantação em produção.

### Consistência transacional entre observação e persistência (1C2-A3b2b2c9)

O Transcoder pode responder `SUCCEEDED` ou `FAILED` enquanto uma nova
versão, cancelamento ou nova reserva de polling substitui o job consultado.
Por isso, `providerSucceededObserved` e `providerFailedObserved` contam
somente respostas externas. Os contadores `providerSucceededApplied` e
`providerFailedApplied` são incrementados **somente após a conclusão bem-sucedida
da transação Firestore** que confirma a versão, a reserva, a identidade do
arquivo original e a geração quando fixada. `processingReplaced` separa
resposta tardia de tentativa já substituída; `providerTerminalCancelRequested`
registra cancelamento persistido devido ao original ausente, caminho alterado
ou geração incompatível. Não confundir cancelamento solicitado com exclusão
executada nem resultado terminal observado com publicação confirmada.

Submissão e recuperação diferenciam `APPLIED`, `REPLACED` e
`CANCEL_REQUESTED`: os contadores de submissão/recuperação confirmada
representam apenas transações que realmente persistiram o vínculo do
provedor na tentativa atual. Alteração do original encaminha ao mesmo
caminho de cancelamento existente, sem publicar derivados ou remover arquivos.
Uma resposta `FAILED` observada na versão antiga não é uma falha persistida
do job corrente.

A `video-processing-terminal-commit.firestore.ts` contém a transação
compartilhada por produção e testes do Firestore Emulator. Não consulta
Transcoder ou Storage nem acrescenta leituras: preserva as duas leituras
transacionais originais de job/vídeo e os mesmos limites do scheduler.
As métricas continuam best effort, e jamais comandam transições,
exclusões, retentativas ou publicação. O campo `evidenceVersion: 3`
impede interpretar registros da versão 2 como evidência de resultado
transacional; estes permanecem `UNVERIFIED` até novo ciclo. A proteção
contra concorrência se baseia no `processingVersion`, job externo e
`nextAttemptAt`, não nos contadores de observabilidade.

### Resiliência da observabilidade operacional (1C2-A3b2b2c10)

A observabilidade permanece restrita a três documentos
`media_video_scheduler_execution/{scheduler}`. O campo `recentIncidents`
preserva no máximo cinco ocorrências `FAILED` ou `ATTENTION` na janela
de 24 horas relativa ao último ciclo. `historyVersion: 1` identifica a
migração gradual; um registro antigo sem histórico não prova ausência de
incidentes. O histórico guarda apenas timestamps, fase, resultado e um
identificador aleatório de ciclo, sem dados de vídeos ou mensagens de erro.

O merge ordena `finishedAt`, `startedAt` e `cycleId` de modo determinístico.
Ciclos encerrados fora de ordem podem acrescentar um incidente sem substituir
o ciclo mais recente. Duplicatas não alteram a evidência. Cada tentativa
lógica usa uma leitura transacional e no máximo uma escrita no **mesmo
documento**. Contenção pode causar novas leituras internas pelo SDK; conferir
taxas de retry e os custos físicos nas métricas do Firestore. O painel mantém
três leituras de documento por consulta. Não há polling novo, varreduras
nem chamadas externas adicionais.

O diagnóstico separa último ciclo, incidente recente e confiabilidade:
`RECENT`, `STALE`, `MISSING`, `INVALID`, `READ_UNAVAILABLE`.
Quando a leitura da telemetria falha, o resultado é indisponibilidade de
observabilidade, não falha do job. Gravações são best effort e falhas
geram `VIDEO_MEDIA_SCHEDULER_EVIDENCE_UNAVAILABLE` no Cloud Logging.
Não é possível persistir no mesmo Firestore indisponível uma prova de que
ele recusou a gravação. Por isso mesmo `RECENT` não comprova histórico
completo: incidentes perdidos devem ser investigados via logs.

Nada nesse histórico modifica publicação, cancelamentos, lease, versão,
geração, retentativa, Storage ou exclusões. Os testes cobrem concorrência,
ordem de conclusão, timestamp empatado, recuperação, ciclo sem jobs e
falha da gravação. Código publicado na main não significa deploy.

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

### Auditoria cruzada offline dos três schedulers (1C2-A3b2b2c11)

A ferramenta `inspect-video-scheduler-logs.mjs` analisa somente um arquivo local
com eventos estruturados de submissão, reconciliação e cancelamento, além de
`VIDEO_MEDIA_SCHEDULER_EVIDENCE_UNAVAILABLE`. Não executa consultas cloud,
não gera gravações Firestore e não consulta o Transcoder. A auditoria legada
de cancelamentos permanece disponível e com seu contrato preservado.

Exemplo PowerShell, em um projeto explicitamente selecionado:

```powershell
$events = @('VIDEO_MEDIA_SCHEDULER_STARTED', 'VIDEO_MEDIA_SCHEDULER_FINISHED',
  'VIDEO_MEDIA_SCHEDULER_FAILED', 'VIDEO_MEDIA_SCHEDULER_EVIDENCE_UNAVAILABLE',
  'VIDEO_CANCELLATION_CYCLE_STARTED', 'VIDEO_CANCELLATION_CYCLE_FINISHED',
  'VIDEO_CANCELLATION_CYCLE_FAILED')
$filter = 'jsonPayload.event=(' + (($events | ForEach-Object { '"' + $_ + '"' }) -join ' OR ') + ')'
$arquivo = Join-Path $env:TEMP 'video-media-scheduler-logs.json'
gcloud logging read $filter --project=SEU_PROJECT_ID --freshness=48h --limit=1500 --format=json |
  Set-Content -Encoding UTF8 $arquivo
if ($LASTEXITCODE -ne 0) { throw 'Exportação do Cloud Logging falhou' }
node scripts/dev/inspect-video-scheduler-logs.mjs $arquivo
```

O arquivo deve ter no máximo 8 MiB e 2.000 entradas. A amostra pode estar
truncada por limites da exportação, retenção ou filtros; um limite atingido
é explicitamente sinalizado. O resultado omite UIDs, nomes de jobs, caminhos,
mensagens de erro e `cycleId`. Não compartilhe a exportação bruta.

A correlação identifica pares STARTED/FINISHED/FAILED, duplicações, execuções
sobrepostas, terminais contraditórios e avisos de falha de gravação. A partir
desta versão, os avisos carregam `cycleId` aleatório para correlação exata.
Avisos de versões antigas sem esse campo ficam como não correlacionados, nunca
são interpretados como sucesso. `FAILED_CONFIRMED` significa que o log
registrou falha da invocação, não uma falha do job nem a ausência de disparo.
`SUSPECTED_GAP` requer dois inícios observados separados por mais de três
intervalos esperados (5 ou 30 minutos). Sem início observável, o diagnóstico
é `INSUFFICIENT_EVIDENCE`; com terminal positivo é `EXECUTION_OBSERVED`.
Todas as classificações preservam `schedulerHealth: NOT_VERIFIED`: Cloud
Scheduler, Cloud Run, filtros, versão implantada e retenção exigem conferência
independente. Logs isolados jamais autorizam publicação, cancelamento,
retentativa, movimentação de originais/derivados ou exclusão.

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
## c15 — Feedback de falhas de Media e triagem simples

A biblioteca privada distingue `loading`, `ready` com resultado vazio
real e `error`, reaproveitando o reducer NgRx e a facade existentes.
O serviço Firestore não converte mais falha em `of([])`; o effect
registra diagnóstico sanitizado silencioso e o componente apresenta
erro inline e botão **Tentar novamente**. O retry é disparado apenas
pelo usuário, não por polling nem mutação automática.

O painel de comentários do vídeo público segue o mesmo contrato:
loading/ready/error e retry manual do listener. Uma falha de consulta
não pode ser exibida como “Nenhum comentário”. O erro técnico é
registrado silenciosamente uma vez pelo consumidor. A reprodução
compartilha `NetworkStatusService` e `OFFLINE_USER_MESSAGE`,
preservando regras de autorização, expiração, revogação e tratamento
específico de erro de vídeo.

No suporte administrativo, `video_recovery_queue_load_failed`
identifica falha na consulta da fila, enquanto
`video_recovery_action_failed` identifica falha em uma ação de
recuperação. Não utilizar `video_upload_failed` para essas operações.

Roteiro operacional com equipe reduzida: (1) conexão local;
(2) resultado vazio legítimo versus erro de consulta; (3) código,
reason e operação do diagnóstico sanitizado; (4) estado canônico do
job/conta antes de recomendar reenvio; (5) checks CI e logs de E2E.
Não copiar IDs, tokens, URLs assinadas ou mensagens do Transcoder.
Sem novas varreduras de Firestore, chamadas externas, retries de
escritas, polling ou storage de logs.
