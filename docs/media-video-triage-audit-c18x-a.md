# 1C2-A3b2b2c18x-A — Ensaios adversariais no Firestore Emulator

Quatro testes concorrentes foram adicionados à suíte isolada que exercita os
helpers de produção, sem Transcoder, novos índices, schedulers ou flags.

1. Duas reservas de polling concorrem com exclusão de perfil: no máximo um
   scheduler reserva, e o resultado final é CANCEL_REQUESTED com um evento.
2. SUCCEEDED concorre com exclusão: sucesso pode ganhar primeiro, mas o
   estado final é cancelado, com tombstone, publicação removida e evento
   correspondente. Um resultado tardio não altera o estado nem cria evento.
3. Substituição de processingVersion com VERSION_REPLACED impede dois
   resultados atrasados de alterar job, vídeo privado ou outbox.
4. Rollback imposto após staging não persiste evento; três transações
   concorrentes de cancelamento confirmam apenas uma mudança e um evento.

São evidências limitadas a esses cenários no Emulator, sem pretensão de
cobertura total, sequência global ou custos de produção verificados.
Próxima prioridade c18x-B: recuperação administrativa e exclusão concorrentes
com reconciliação determinística de sessões fechadas.

globalCoverageVerified=false; globallySequenced=false;
productionCostVerified=false; cleanupAuthorized=false.
Sem c19, deploy, flags, consumidores, TTL ou expurgo.