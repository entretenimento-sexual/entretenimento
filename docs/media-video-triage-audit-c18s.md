# 1C2-A3b2b2c18s — Transições de probe/preflight e disciplina de custo do outbox

## Resultado da auditoria

A c18r foi validada com CI 4/4. A c18s examinou os escritores:
`video-source-probe.service.ts`,
`video-immutable-input-preflight.service.ts` e
`admin-video-triage-backfill.firestore.ts`.

**Decisão:** registrar apenas as transições reais de estado de QUEUED
para CANCEL_REQUESTED ou FAILED no probe e no preflight. Não registrar
reserva de claim, retry, atualização de `sourceProbe`, `immutableInput`,
`nextAttemptAt` ou simples manutenção da projeção administrativa
enquanto o estado é preservado.

O probe original é opt-in e o preflight para cópia imutável não está
integrado ao scheduler de submissão. Esta alteração não habilita
essas funcionalidades, não cria flag, não efetua cópias de GCS e não
faz consulta ao Transcoder.

## Transições instrumentadas

| Escritor / ponto de decisão | Estado anterior | Estado posterior | Evento persistido |
| --- | --- | --- | --- |
| Probe: origem privada inválida antes do claim | QUEUED | CANCEL_REQUESTED | 1 |
| Probe: origem alterada após o resultado da inspeção | QUEUED | CANCEL_REQUESTED | 1 |
| Probe: falha permanente não recuperável | QUEUED | FAILED ou CANCEL_REQUESTED | 1 |
| Preflight: fonte privada inconsistente antes da cópia | QUEUED | CANCEL_REQUESTED | 1 |
| Preflight: fonte substituída antes do commit do resultado | QUEUED | CANCEL_REQUESTED | 1 |
| Preflight: falha definitiva de cópia | QUEUED | FAILED ou CANCEL_REQUESTED | 1 |
| Probe/preflight: falha temporária e retry | QUEUED | QUEUED | 0 |
| Probe/preflight: sucesso e metadados verificados | QUEUED | QUEUED | 0 |
| Probe/preflight: claim antigo ou versão substituída | Sem escrita aplicável | Sem escrita aplicável | 0 |
| Backfill administrativo: projeção por versão `updateTime` | Estado inalterado | Estado inalterado | 0 |

Os seis pontos do código são **ramificações mutuamente exclusivas
dentro de cada fase relevante**. Cada evento usa UUID gerado fora do
callback da transação Firestore, `transaction.create` e
`PARTIAL_WRITER_COVERAGE`. Se o commit falha, nenhuma escrita de
evento é persistida isoladamente. Claims e flags seguem o modelo
canônico, sem alteração na política de segurança do vídeo.

## Orçamento incremental de gravações

O custo adicional de cada uma dessas transições efetivamente
confirmada é **1 gravação de documento no outbox**, além das
gravações preexistentes; eventos vetados ou reexecuções sem transição
persistida adicionam **0 gravações de evento**. Nenhuma leitura de
job/Transcoder, query administrativa ou consulta de índices foi
adicionada ao caminho de produção.

`eventWrites_c18s = confirmedProbeStateTransitions +
confirmedPreflightStateTransitions`.

Essa fórmula conta gravações de eventos confirmadas, não cobranças
faturadas. Retries internos da transação podem consumir operações de
SDK que não são equivalentes ao faturamento. Não existe ainda limite
global de documentos, orçamento por hora/dia ou medida de custo real.
Antes de habilitar novos writers, estabelecer um teto operacional
aprovado que não interrompa transições obrigatórias de segurança.

## Retenção e segurança de acesso

O outbox contém o hash SHA-256 da identidade do job, que continua
correlacionável; deve ser considerado evidência administrativa
sensível. Não foi acrescentado acesso público, UI, endpoint ou
permissão Firestore nesta intervenção.

**Nenhuma exclusão, TTL, expurgo ou scheduler de limpeza foi
ativado.** Retenção exige decisão própria: horizonte de auditoria,
base legal e privacidade, prova de consumo reconciliado, tratamento de
tombstones, índices/custo de consulta, política de backup e limite
financeiro. Apagar eventos antes da conciliação invalidaria qualquer
pretensão de reconstruir eventos históricos. Reter indefinidamente
também não é solução aprovada: crescimento de armazenamento ainda
não foi quantificado.

## Evidências, limites e bloqueios

Os testes do Firestore Emulator verificam registro de cancelamento,
falha definitiva, ausência de evento em sucesso/retry/claim obsoleto;
o contrato de arquitetura verifica o fechamento de ramificações,
o fencing de updateTime do backfill e a inexistência de evento de
estado no backfill.

Esta etapa **não** demonstra captura global de todos os updates,
replay independente ou sequência total: faltam outros escritores,
metadados de poll, fluxos administrativos legados, clientes externos,
movimentos de mesmo estado e histórico anterior ao outbox.

`globalCoverageVerified=false`,
`globallySequenced=false`, `productionCostVerified=false`
continuam sendo as únicas interpretações admissíveis desta etapa.

**c19 e ordenação global seguem bloqueadas.** Nenhum deploy,
branch, PR ou ativação de flags.
