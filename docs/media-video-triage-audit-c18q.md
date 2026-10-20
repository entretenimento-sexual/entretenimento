# 1C2-A3b2b2c18q — Outbox parcial em fila, submissão e terminal

## Mudanças

A c18q amplia a fonte de evidências criada na c18p, utilizando a
mesma coleção `media_video_processing_mutation_events`. O evento continua
atômico com a transação do Firestore e contém apenas identidade de job
como hash SHA-256, estados anterior/posterior, versão validada e timestamp.

Escritores explicitamente instrumentados nesta etapa:

- `queue-video-processing.handler.ts`: criação de QUEUED, transição
  para FAILED por receita inválida e CANCEL_REQUESTED quando o upload
  é cancelado; gravação única dentro da transação que cria/altera o job.
- `video-processing.handler.ts`: claim de QUEUED para SUBMITTING,
  falha de tentativas máximas, cancelamento por vídeo ausente/fonte
  substituída e confirmação de submissão para PROCESSING ou
  CANCEL_REQUESTED.
- `video-processing-terminal-commit.firestore.ts`: transição para
  SUCCEEDED/FAILED após confirmação, ou CANCEL_REQUESTED se a fonte
  não existir ou não corresponder à geração original.

Uma operação sem mudança de estado pode atualizar outros campos do
job **sem produzir evento de transição**. A etapa não declara cobertura
de todas as mudanças de metadados, polling, preflight, backfill,
writers administrativos ou externos.

## Propriedades transacionais

- UUID de evento definido fora do callback de transação: retries do
  SDK não geram identidades alternativas para uma mesma tentativa.
- `transaction.create` no documento do outbox: IDs já usados
  provocam falha transacional, nunca overwrite.
- Criação de QUEUED aceita somente o snapshot de ausência lido pelo
  próprio executor; registra `previousState=null` e uma versão válida.
- Transições existentes requerem snapshot atual e próximo estado
  permitido; `STATE_TRANSITION` para o mesmo estado é rejeitado.
- Eventos de cancelamento são gravados somente quando o escritor
  realmente troca o estado do job para CANCEL_REQUESTED.
- Claims substituídos, versões antigas ou jobs ausentes não geram
  eventos; o fencing dos escritores continua sendo a autoridade.
- Aborto ou falha antes do commit não deixam um evento independente.

## Custos e limites

Cada operação instrumentada com evento confirmado passa a realizar
**uma escrita adicional** na coleção do outbox. Essa reserva ainda
não integra um teto global de custos, e a retenção e os índices para
consulta histórica ainda precisam de uma decisão operacional.
Não há nova consulta ao Transcoder, polling nem varredura ampla.
Os índices e regras de produção não são implantados nesta etapa.

## Evidências e pendências

O teste do Firestore Emulator inclui rollback de criação, ausência
de evento para operação substituída, estado terminal confirmado,
cancelamento terminal por fonte alterada e transição para PROCESSING,
além dos testes de c18p para tombstone e replay.

Este journal **não** constitui um log exaustivo, globalmente
sequenciado ou independente dos escritores. Os próprios eventos
continuam declarando `PARTIAL_WRITER_COVERAGE`,
`globallySequenced=false` e `globalCoverageVerified=false`.

Próximas pendências prioritárias: instrumentação de poll/retry/recovery,
atualizações administrativas, probes/preflight, exclusões remanescentes;
garantia verificável de não perda; retenção/custos medidos, reconciliação
histórica e fontes externas; índices READY e avaliação dos nove critérios.

**c19 e ordenação global: bloqueadas.**
Sem deploy, branches, PRs ou ativação de flags.
