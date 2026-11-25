# CHAT-R1.10.2.2 — Recuperação reativa de listeners

Base de58a5983983302deb504e5ac0fdbe8f63e031cc aprovada no Chromium e Quality Gate. A intervenção foi antecipada antes da paginação para consolidar estabilidade.

- Fallback fail-closed emitido imediatamente a cada falha recuperável; erros não reconhecidos continuam propagando. Backoff finito existente preservado.
- Após esgotamento, eventos online, foco, pageshow e retorno de visibilidade permitem reativação. Falhas de transporte têm uma única tentativa adicional após 120 segundos, sem depender de eventos do navegador. Permission-denied nunca usa essa tentativa. Sem polling infinito.
- Orçamento só é reiniciado depois de um período de 30 segundos com valor confirmado pelo consumidor. Cache, loading e fallback não são usados como prova. Projeção privada usa metadados de servidor; thread, conversas individuais e notificações usam valores positivos conservadores, pois zero/lista vazia podem representar cache. A descoberta global permanece conservadora sem predicado.
- repeat encerra gerações anteriores e não reinscreve após conclusão normal. Cancelamento externo por sessão/seleção encerra timers e listeners. Nenhuma alteração de Rules, Functions, rate limits, fontes canônicas, nomenclatura existente ou apresentação de erros.
- Quatro regressões adicionais sobre tentativa lenta limitada, recuperação sem evento, estabilidade confirmada e cache/observação breve. Testes não executados localmente; aprovação de CI e Chromium do novo SHA obrigatória. Recuperação após a tentativa adicional esgotada continua dependente de evento/alteração do contexto; não é uma garantia de reconexão automática permanente. Escala de descoberta, agregação de não lidos e certificação dos demais pontos de entrada permanecem pendentes.
