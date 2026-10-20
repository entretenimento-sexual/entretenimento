# 1C2-A3b2b2c18u — Escritores de jobs: cobertura seletiva e lacunas verificáveis

## Escopo e semântica

O inventário de escritores continua **parcial**. A c18u confronta os
pontos de escrita identificados na c18o–c18t com o outbox transacional
`media_video_processing_mutation_events`. O censo estático não observa
clientes externos, aliases arbitrários, migrações manuais ou histórico antigo.
Portanto, **não** certifica captura global, sequência total, custos reais nem
autorização da c19.

Uma escrita de lease, metadados, polling ou projeção derivada sem mudança de
estado não exige um evento. Para uma transição de estado elegível, o evento
deve ser criado no **mesmo commit**; tentativas abandonadas, versões
substituídas e reexecuções vetadas não podem produzir eventos isolados.

## Matriz de pontos identificados

| Escritor | Tratamento nesta revisão | Limitação |
| --- | --- | --- |
| queue-video-processing.handler.ts | Criação/cancelamento instrumentados na c18q | Requer prova externa de completude |
| video-processing.handler.ts | Claim, confirmação e mudanças terminais selecionadas | Polls/leases sem estado não geram eventos |
| video-processing-reconciliation.firestore.ts | Mudanças relevantes e DELETE selecionados | Metadados de reconciliação não são change feed |
| video-processing-terminal-commit.firestore.ts | Transições terminais instrumentadas | Concorrrência depende de fencing do job |
| admin-video-processing-recovery.handler.ts | Recovery e versão substituída na c18r | Rechecks sem estado não geram eventos |
| video-source-probe.service.ts | CANCEL_REQUESTED/FAILED na c18s | Sem instrumentar claim, retry, sucesso sem estado |
| video-immutable-input-preflight.service.ts | CANCEL_REQUESTED/FAILED na c18s | Mesmo recorte do probe |
| admin-video-triage-backfill.firestore.ts | Somente atualização de projeção | Não emitir transição fictícia |
| account-owned-media-deletion.firestore.ts | Cancelamento e DELETE instrumentados na c18p | Cobertura global de exclusão não comprovada |
| emulator-video-processing.service.ts | **c18u**: FAILED e SUCCEEDED com evento atômico | Exclusivo do ambiente Emulator |
| delete-profile-video.handler.ts | **LACUNA CRÍTICA**: WriteBatch CANCEL_REQUESTED sem evento | Precisa refatoração com snapshot/fencing transacional |
| Escritores externos, migrações, aliases | **SEM PROVA** | Censo do repositório é insuficiente |

## Correção delimitada na c18u

O serviço de conclusão local de vídeos no Emulator recebe origem
`EMULATOR_PROCESSING`. Apenas duas transições `QUEUED → FAILED` e
`QUEUED → SUCCEEDED` criam um evento por transação confirmada. O UUID
é escolhido antes do callback (retries Firestore reutilizam a identidade),
e a transição exige a mesma `processingVersion`, além do estado QUEUED
e dos controles existentes de identidade de origem. Não são acrescentados
reads, chamadas ao Transcoder, escritas separadas ou flags.

O contrato de arquitetura exige os dois pontos de captura, fencing de
versão e mantém explícita a lacuna no batch de exclusão de perfil. O teste
no Firestore Emulator verifica o par evento/job para as duas transições,
a ausência de evento em reexecução obsoleta e o rollback em transação
abandonada. Esse ensaio prova a semântica do helper usado pelo escritor,
não um E2E completo da cópia de objetos Storage no Emulator.

O workflow isolado passa a ser acionado por mudanças no serviço local.

## Lacuna de exclusão de perfil — pendência prioritária

`delete-profile-video.handler.ts` chama
`requestProcessingCancellation(removalBatch, ...)` e usa
`removalBatch.commit()`. Esse caminho pode persistir
`CANCEL_REQUESTED` sem evento, pois o outbox atual exige snapshot
lido **dentro da mesma transação**. Não simular cobertura com uma escrita
de evento criada fora da confirmação do estado.

A correção subsequente deve preservar o contrato do guard de identidade
(`RETIRED` e precondições de versão), a criação exclusiva do job de
exclusão, os tombstones, o isolamento do vídeo privado e o fencing da
publicação. Testar concorrência entre exclusão, reenvio/registro e claim
do scheduler. **Esta lacuna impede encerrar a cobertura de escritores.**

## Custo, retenção e prontidão

Na operação local instrumentada: +1 documento no outbox por transição
confirmada; zero evento em versão obsoleta ou rollback. Não há
estimativa de faturamento de produção. A retenção continua fail-closed:
nenhum TTL, expurgo, consumer ou limpeza automática foi autorizado.

`globalCoverageVerified=false`;
`globallySequenced=false`;
`productionCostVerified=false`;
`cleanupAuthorized=false`.

A c19, a ordenação global, deploy e flags permanecem bloqueados.

## Correção subsequente do gate canônico

Na primeira publicação da c18u, os três checks funcionais passaram, mas
o gate canônico falhou em `functions_audit`: o lockfile mantinha a
dependência transitiva `follow-redirects@1.16.0` com advisories de
exposição de credenciais por redirecionamento. Atualizados
`functions/package.json` (override explícito) e
`functions/package-lock.json` para `1.16.1`, preservando o
hash de integridade oficial da distribuição. Nenhuma versão major,
alteração de dependências não relacionadas ou execução de deploy foi
autorizada. A revisão só deve ser marcada como concluída após CI 4/4
na nova cabeça da main.
