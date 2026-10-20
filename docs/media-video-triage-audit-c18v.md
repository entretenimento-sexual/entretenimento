# 1C2-A3b2b2c18v — Exclusão do perfil e outbox no mesmo commit

## Correção

O caminho `delete-profile-video.handler.ts` deixa de cancelar o job num
`WriteBatch` montado com snapshots previamente observados. O novo
`commitProfileVideoDeletionRequest` executa uma transação Firestore com
leitura do job de exclusão, vídeo privado, publicação, job de processamento
e guard de identidade. Só depois dessas leituras valida a retenção por
moderação, deriva os caminhos de limpeza e confirma atomicamente:

1. `RETIRED` do guard, impedindo reutilização de `videoId`;
2. criação exclusiva do job de limpeza, preservando lease e dead letter;
3. `CANCEL_REQUESTED` no job, quando há mudança elegível de estado;
4. um único evento `PROFILE_VIDEO_DELETION` no outbox, **no mesmo commit**;
5. despublicação das referências privada de publicação e pública.

O UUID é gerado uma única vez antes dos retries transacionais. O estado,
a versão e a propriedade do job vêm do snapshot transacional; uma
alteração concorrente obriga o Firestore a validar/reexecutar a
transação. O tombstone usa `lastUpdateTime` na atualização de
identidade, e a publicação preserva a sua precondição.

## Idempotência e casos sem evento

Pedido duplicado encontra o job de exclusão e não altera seu lease,
estado, paths, guard ou outbox. Estado já `CANCEL_REQUESTED` ou
`CANCELLED`, ou job de processamento ausente, não produz transição
fictícia. Publicação em retenção `FLAGGED` ou `PENDING_REVIEW`
protegida permanece bloqueada sem confirmação parcial; chamadas de
moderação com autorização explícita preservam o caminho já existente.

Os testes verificam commit conjunto, duplicações concorrentes,
identidade sem reutilização, ausência de eventos redundantes,
rollback por falha de validação e competição entre registro e
exclusão. A execução da limpeza externa ocorre **depois** do commit,
sem novas consultas ao Transcoder e sem agendador adicional.

## Limitações e prontidão

A c18v fecha **apenas** o escritor canônico de exclusão de perfil.
Outros escritores externos, legados e mutações não classificadas
continuam fora de prova global. Não foi criado consumer, sequenciador
global, TTL, purge, índice global ou ativação de c19.

`globalCoverageVerified=false`;
`globallySequenced=false`;
`productionCostVerified=false`;
`cleanupAuthorized=false`.

Como o outbox acrescenta uma escrita por cancelamento realmente novo,
o custo ainda precisa ser confirmado com medições operacionais. A
CI verde comprova contratos e testes do escopo, não cobertura total
em produção.
