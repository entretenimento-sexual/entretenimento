# c18p — Outbox parcial, atômico, para mutações críticas de jobs de vídeo

## Escopo efetivamente instrumentado

Esta intervenção **não é um change feed global**. Ela adiciona somente uma
fonte de evidências backend-only às três transações de
`account-owned-media-deletion.firestore.ts` e à exclusão protegida em
`video-processing-reconciliation.firestore.ts`.

As mudanças selecionadas são:
- encerramento de conta: exclusão de job terminal com confirmação do mesmo
  `updateTime` e dono antes da exclusão;
- encerramento de conta: marcação de `CANCEL_REQUESTED` em jobs ativos na
  página, com projeção transacional;
- encerramento de conta: ocultação das publicações e marcação condicional
  de `CANCEL_REQUESTED` na mesma transação;
- reconciliação de cancelamento: tombstone no mesmo commit que executa
  `transaction.delete(jobRef)`, sob o fencing já existente.

O código novo fica em
`admin-video-triage-mutation-outbox.firestore.ts`, com coleção isolada
`media_video_processing_mutation_events`. Cada evento usa ID aleatório
gerado **antes** de a transação começar; o evento é criado por
`transaction.create` com o job na mesma transação. Uma transação
abortada não registra evento isolado. Reutilizar o mesmo ID falha, em vez
de sobrescrever evidências.

A carga é mínima: schema, origem e tipo de mutação, hash SHA-256 da
identidade do job, estado anterior/posterior, versão de processamento
validada, `updateTime` anterior e timestamp do servidor. Não copia
UID do proprietário, caminhos, conteúdo do vídeo, tokens nem payload
inteiro do job. O evento de DELETE fornece um tombstone independente
após a exclusão do documento.

O fluxo de encerramento de conta conserva a ordem externa de limpeza
do storage anterior à exclusão terminal. O registro transacional não
transforma a remoção do storage em operação atômica: falhas/concorrência
externa precisam de revisão específica; não foi criada uma segunda
política de remoção nem uma rotina automática nova.

## Segurança e idempotência

- O evento só aceita referência direta à coleção de processamento e
  snapshot preexistente lido pela transação.
- O cancelamento é protegido por releitura da versão corrente do job
  e por rejeição de estados terminais/cancelamentos já solicitados.
- A exclusão de conta protege job terminal por `updateTime` observado;
  mudanças concorrentes impedem a exclusão e exigem revisão/reexecução.
- A exclusão da reconciliação conserva o guarda canônico de versão e
  claim do job atual, evitando tombstone para tentativa substituída.
- Não há consulta nem comando ao Transcoder, novos schedulers, acesso
  frontend, flags ou deploy nesta intervenção.
- Cada mutação instrumentada adicionará uma escrita de evento quando
  o código for implantado; custo e retenção **ainda não aprovados**.

## Validação e limites

O teste de integração com Firestore Emulator cobre aborto com rollback
conjunto, commit aplicado, falha no replay de mesmo ID, ausência de
evento para job inexistente e tombstone de cancelamento somente quando
o job realmente é excluído. O contrato estático verifica os pontos de
integração e a enumeração corrigida dos consumidores da coleção.

**Cuidado:** não existe uma ordem total de eventos entre transações,
não há instrumentação de todos os produtores, nem retenção de eventos
definida. O registro é `PARTIAL_WRITER_COVERAGE`, com
`globalCoverageVerified=false` e `globallySequenced=false`.
A CI verde demonstra apenas o comportamento testado, não a captura
integral de mudanças de produção.

## O que ainda falta para cobertura global

1. Completar a instrumentação de todos os escritores, inclusive
   criação/submit/poll/probe/preflight/recovery/backfill e externos.
2. Definir outbox versionado com reconciliação independente de perdas,
   sequenciamento de transições e limites de retenção/custos reais.
3. Planejar a migração de histórico e casos de exclusão de conta
   anteriores ao novo journal, respeitando privacidade.
4. Comprovar índices READY, atualização temporal e a integridade dos
   nove critérios do gate, com autorização separada.

**c19 e a ordenação global permanecem BLOQUEADAS.**
