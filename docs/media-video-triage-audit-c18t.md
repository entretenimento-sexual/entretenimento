# c18t — Orçamento auditável e retenção fail-closed do outbox de vídeo

## Correção de entrada: CI da c18s

A revisão `761c64ed` passou nos três checks específicos, mas **falhou no
Canonical quality gate por duas ocorrências de aspas incompatíveis com o
lint do teste de contrato**. A c18t corrige esse problema antes de ser
considerada válida. Nunca tratar a c18s como CI 4/4 enquanto não existir
novo commit aprovado nos quatro checks.

## Diagnóstico do outbox

O outbox `media_video_processing_mutation_events` tem eventos
`PARTIAL_WRITER_COVERAGE`, sem sequência global comprovada. Nos pontos
instrumentados, `transaction.create` no mesmo commit adiciona **uma
gravação de evento para cada operação elegível aplicada**. Isso não
equivale a uma tarifa nem a uma contagem completa das operações faturadas.

Uma leitura das fontes mostra os seguintes limites:

| Grupo de escritores | Cobertura e lacunas |
| --- | --- |
| Fila de vídeo | Criação e mudanças de estado selecionadas instrumentadas; atualizações internas sem transição não constam |
| Submissão e confirmação terminal | Transições elegíveis instrumentadas; alterações de metadata e leases podem ocorrer sem novo evento |
| Reconciliação do provider | Exclusão com tombstone e mudanças de estado selecionadas; polling e contadores sem transição não constam |
| Recuperação administrativa | Retentativas que substituem versão e mudanças de estado selecionadas; rechecagens sem mudança não constam |
| Exclusão de conta e cancelamento | Caminhos críticos selecionados instrumentados; histórico anterior não é recuperado retroativamente |
| Probe e preflight de input imutável | CANCEL_REQUESTED/FAILED instrumentados; claims e retries permanecem sem evento |
| Backfill da projeção administrativa | Nenhuma transição de estado; não cria eventos por simples atualização de projeção |
| Emulador, manutenção legada, migrações, clientes externos | Sem prova de completude e de captura obrigatória por todos os escritores |

**Não confundir lista de caminhos do repositório com registro global
imutável.** A coleção ainda não possui certificação externa de escritores,
watermark sequenciado nem reconciliação independente de eventos perdidos.

## Orçamento offline executável (sem novos reads)

A c18t inclui `assessVideoTriageOutboxCostWindow`, função determinística
pura, sem I/O e sem comando destrutivo. Recebe uma observação expressamente
`OFFLINE_EMULATOR_OR_MANUAL_REPORT`, com janela temporal, eventos novos,
bytes amostrados, quantidade de documentos amostrados e total retido quando
conhecido. Recebe também limites **explícitos**, separados do relato:
máximo de novos eventos por janela, taxa de eventos/hora, tamanho da
amostra e duração máxima da observação (até 24 h).

Retorna `INVALID_OBSERVATION`, `MISSING_APPROVED_LIMITS`,
`EXCEEDS_OFFLINE_THRESHOLDS` ou `WITHIN_OFFLINE_THRESHOLDS`.
Taxa é calculada por `ceil(eventos * 3600000 / duração_ms)`.
Somente contadores válidos e limites informados podem receber o último
estado; mesmo nesse caso:

- `productionCostVerified=false`
- `globalCoverageVerified=false`
- `globalOrderingEnabled=false`
- `cleanupAuthorized=false`

Não há preço presumido, nova consulta ao Transcoder/Firestore, orçamento
operacional imposto a usuários nem bloqueio de transição obrigatória de
segurança por falha de observabilidade. Bytes informados são **amostra
submetida**, não bytes faturados. O instrumento não possui integração
com métricas de cobrança do Google Cloud ou com um fluxo autorizado
de agregações de produção.

## Retenção fail-closed e proteção contra perda de evidências

`assessVideoTriageOutboxRetentionPrerequisites` apresenta requisitos:
cobertura completa de escritores, sequência imutável, checkpoint
independente de consumo, horizonte de tombstone aprovado e avaliação
legal/privacidade. Mesmo que esses flags sejam preenchidos pela
entrada, a resposta é `RETAIN_AND_REVIEW`, com
`cleanupAuthorized=false`: declarações autoatestadas não legitimam
apagar histórico.

**Não foi implementado TTL, expurgo, rotina de limpeza ou deleção de
eventos.** O princípio é não destruir prova nem ampliar armazenamento
sem decisão documentada e posterior avaliação de segurança.
Retenção indefinida também não foi aprovada — continua um passivo a
dimensionar.

## Evidências de teste

Testes puros cobrem limites exatos, excesso de eventos/taxa/bytes/janela,
entradas inválidas, limites ausentes, amostras vazias e recusa permanente
de autorização para limpeza. Contrato de arquitetura bloqueia o retorno
de `true` para cobertura, custo e cleanup e verifica inexistência de
schedulamento destrutivo no outbox. Regressão da c18s: duas aspas no
teste de contrato ajustadas para o padrão de lint.

## Pendências antes da próxima promoção

1. Censo de todos os caminhos de escrita e origens externas com evidência
   independente e completa, não apenas scanner estático.
2. Sequenciamento ou snapshot válido e reconciliação entre histórico,
   tombstones, mudanças de faixa e IDs omitidos.
3. Plano aprovado de retenção, privacidade, controle de leitura
   backend-only, custos de escrita/armazenamento e medição financeira real.
4. Ensaios de concorrência, falhas e volume sobre o outbox sem
   regressões em processamento, media immutability e exclusão.
5. Índices READY, ciclos temporais, cobertura legada e nove requisitos
   do gate global, com autorização independente.

**c19, ordenação global, deploy e flags continuam bloqueados.**
