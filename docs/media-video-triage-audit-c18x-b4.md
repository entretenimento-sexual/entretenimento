# c18x-B4 — Reconciliação determinística do outbox em sessões fechadas

## Escopo e evidência independente

O reconciliador **somente de leitura**, sem acesso a Firestore nem qualquer
ação produtiva, recebe um manifesto do harness de testes dos commits
confirmados, um conjunto completo de eventos do outbox para os hashes
incluídos e um snapshot final dos jobs. A ordem no manifesto é por job:
não representa sequência global entre transações de jobs diferentes.

A prova de fechamento (writers suspensos, consultas exaustivas do recorte)
é uma asserção do harness **Emulator**, não um atestado de produção.
Sem esse fechamento, o resultado é INCONCLUSIVE, nunca sucesso.

## Casos validados

- Criação QUEUED e cancelamento de exclusão de perfil pelo escritor real;
  cada evento compartilha o respectivo commit Firestore.
- Ausência de evento após remoção simulada, mesmo quando o estado final
  permanece válido, identificada pelo manifesto de commit independente.
- Evento adulterado detectado por divergência de estado ou payload.
- Evento lógico duplicado (ID diferente) e evento extra detectados.
- Job alterado sem evento, detectado por divergência entre replay e final.
- Ordem de retorno dos eventos não altera o diagnóstico.
- Manifesto fora de ordem, incompleto, não fechado ou acima do limite
  gera INCONCLUSIVE; não autoriza correção automática nem expurgo.

Limites explícitos: no máximo 16 jobs e 64 eventos por recorte, sem query
produtiva, scans, novos writers, índice, trigger, agenda ou Transcoder.
Essa verificação não reconstrói fatos históricos fora do manifesto
e não garante completude dos escritores globais ou custos reais.

globalCoverageVerified=false; globallySequenced=false;
productionCostVerified=false; cleanupAuthorized=false.

Próxima c18x-B5: auditoria final e encerramento do escopo c18x.
C19, ativação, sequencing global, TTL, deploy, flags e PR permanecem bloqueados.