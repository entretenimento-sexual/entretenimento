# CHAT-R1.10.3.4.2a — Emissões de mensagens e capacidade útil de recibos

Base homologada: 7c4079fc. Quality Gate 45803921020 e Chromium 45803920916 aprovados.

Primeira intervenção da etapa 4.2: o projetor por listener descarta exclusivamente snapshots consecutivos de servidor sem mudança documental nem mudança no indicador agregado de gravações pendentes. Mantém a primeira confirmação, transições de recibos, remoções e limpeza na perda de confirmação. Não retém conteúdo, não altera a consulta (60 mensagens), não altera o cursor histórico e não compartilha mensagens entre sessões ou consumidores.

O lote de recibos passa a excluir transições já confirmadas ou em voo antes de aplicar o limite de 50. A deduplicação também é verificada no despacho. Mantém as transições sent -> delivered -> read, o limite de 5 escritas simultâneas por chamada, os gates e o diagnóstico canônico existentes.

Testes acrescentados para emissões redundantes, confirmação inicial, cache, reconexão, transições pendentes, remoções e capacidade útil do lote. A nova CI deve certificar o commit. Não se afirma redução de leituras faturadas, nem limitação global de concorrência entre lotes. Compartilhamento de listeners de mensagens e coordenação global de recibos exigem intervenções separadas com prova de isolamento e autorização independente. Nenhuma mudança em UI, Rules, Functions, produção ou permissões.
