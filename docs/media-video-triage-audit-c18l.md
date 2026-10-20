# c18l — Verificação consolidada de concorrência, custos e cobertura (offline)

## Objetivo e limites de autoridade

Esta etapa não ativa priorização global nem produz certificação de produção.
`validateVideoTriageAuditSession` interpreta o checkpoint HMAC e as reservas
do journal de uma sessão manual no Emulator. Não consulta jobs, não executa
backfill, não chama Transcoder, não escreve Firestore e não altera agendamento.

A CI verde valida os cenários testados, mas **não equivale** a cobertura
global ou custos reais de um projeto em produção.

## Evidência reprodutível de concorrência entre faixas

O cenário adversarial `c18l crossing state lanes` cria dois jobs isolados:
um em QUEUED e outro em PROCESSING. O primeiro é observado em QUEUED;
entre duas consultas, ambos trocam de estado. A consulta posterior de
PROCESSING volta a observar o primeiro, enquanto o segundo migrou para a
faixa que já passou. Foram vistas duas observações, mas apenas um ID
distinto: a duplicação e a omissão compensam-se numericamente.

Esse resultado é possível mesmo que cada consulta individual tenha
`hasMore = false` e os documentos estejam estáveis na sua releitura.
Logo, `pagesCompleted`, `lanesExamined`, somatórios e sucesso transacional
não provam que todos os jobs foram cobertos. Uma verificação global requer
um snapshot realmente consistente ou mecanismo de reconciliação de
movimentos e uma comparação independente dos IDs observados.

O protocolo c18k continua preservado: nenhuma leitura operacional da
sessão durável começa sem claim/reserva. As leituras diretas do teste são
apenas fixtures locais, sob Firestore Emulator isolado, para demonstrar
a limitação do algoritmo de cursores.

## Limite conservador de custos

Uma tentativa de página reserva no ledger até
`2 * pageSize + 1` leituras dos jobs (consulta limitada a pageSize + 1,
seguida de até pageSize releituras pontuais). O journal reserva até
`4 * maxTransactionAttempts + 1` unidades conservadoras por claim
(atualmente 9), equivalentes a leituras e gravações de claim e settlement,
considerando até duas tentativas transacionais por operação e uma leitura
de recuperação. São tetos lógicos de reservas, **não** medição faturável.

A validação exige, por sessão:

- `reservedDocumentReads === pagesAttempted * (2 * pageSize + 1)`;
- `journalReservedOperations === pagesAttempted * 9`;
- limites de páginas, documentos e reservas respeitados;
- ausência de transposição do envelope máximo assinado.

Leituras manuais de status, leituras de recuperação adicionais, registro
da sessão, disputas de transação e chamadas posteriores não estão cobertos
por essa reserva. Os campos opcionais de instrumentação do Emulator ajudam
a revisar a diferença; não autenticam cobrança nem são prova de custo
de produção. Contenção ou repetição de consultas exige medição explícita
adicional para se definir um teto completo.

## Evidências ainda necessárias para encerramento da priorização global

1. Método comprovável de cobertura global sob mudança simultânea de estado
   e cursor, incluindo omissões e duplicidades, sem novos acessos ao Transcoder.
2. Instrumentação real dos limites de query/transaction/retries, incluindo
   leituras manuais fora do envelope, e teste de carga controlado.
3. Vencimentos temporais processados em ciclos reais e atraso admissível.
4. Backfill legado conferido em ambiente explicitamente autorizado.
5. Dois índices efetivamente READY no projeto e banco corretos.
6. Nove critérios do gate com evidências independentes e revisão operacional.
7. Decisão de ativação separada, explícita e com plano de reversão.

**Prontidão da c19: bloqueada.** No código de validação,
`globalCoverageVerified`, `concurrentCursorSafetyVerified`,
`productionCostVerified` e `globalOrderingEnabled` permanecem false
independentemente dos números da sessão.
