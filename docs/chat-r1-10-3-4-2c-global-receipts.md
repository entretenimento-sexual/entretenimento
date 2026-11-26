# CHAT-R1.10.3.4.2C — Coordenação global de recibos

Base homologada: 3fcb1e7f, Quality Gate 45808071964 e Chromium 45808071625.

DirectReceiptsService passa a limitar cinco subscrições de gravação simultâneas para todos os lotes e conversas da mesma instância. A fila FIFO tem no máximo 250 itens aguardando, além dos cinco ativos; cada chamada mantém lote de até 50 transições e até cinco itens submetidos à fila simultaneamente. Transições iguais são reservadas enquanto aguardam ou executam; a confirmação continua temporal e depende de emissão do transporte. Sob saturação o item não admitido não conta como sucesso e pode ser reapresentado por snapshot futuro; não há polling, timer de retry nem escrita fora da assinatura do consumidor.

Cancelamento de uma assinatura remove seus itens enfileirados; a drenagem depois de cancelamento ocorre em microtask, evitando despacho de irmãos durante teardown síncrono. A troca/revogação de sessão invalida a geração antes do despacho, e a destruição cancela todos os lotes. A facade mantém o cancelamento por conversa; as Rules continuam autoridade para cada escrita. As transições sent -> delivered -> read e o tratamento canônico de erros permanecem. A concorrência é de operações observadas pelo cliente: unsubscribe não aborta uma Promise de Firestore já enviada. O limite não é compartilhado entre abas/dispositivos nem substitui controle de servidor.

Testes acrescentados para concorrência entre lotes e conversas, deduplicação de itens aguardando, cancelamento, erro, destruição e saturação da fila. Sem alterações de UI, Rules, Functions ou deploy. A certificação do novo commit permanece necessária.
