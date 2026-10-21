# c18x-B2 — Cancelamento administrativo e reconferências concorrentes

Version fencing para todas as ações de mutateExistingJob, inclusive CANCEL_ACTIVE,
RECHECK_STALE e RECHECK_UNCONFIRMED, antes tratado apenas em RECHECK_PROVIDER.
Chamadas antigas sem versão são rejeitadas; o painel atual já envia a versão.
Reuso do mesmo operationId com ação diferente é rejeitado.

As operações administrativas passam a ler, dentro da transação, os documentos
de exclusão e identidade para não reativar vídeo cuja exclusão já começou.
O acréscimo são duas leituras pontuais por operação administrativa rate-limited;
não há consultas adicionais ao Transcoder, schedulers, indexes ou varreduras.

Três novos testes no Firestore Emulator:
1. CANCEL_ACTIVE concorrente com cada uma das três reconferências.
2. Comando de versão antiga após retry real; idempotência e colisão de ID.
3. Exclusão de perfil concorrente com RECHECK_UNCONFIRMED.

Outbox permanece parcial, sem ordem global. Não há autorização para c19,
deploy, TTL, consumidores, flags ou exclusão automática.
globalCoverageVerified=false; globallySequenced=false;
productionCostVerified=false; cleanupAuthorized=false.
Próxima: c18x-B3 (exclusão de conta vs processamento).