# CHAT-R1.10.3.3.1 — Transporte progressivo de descoberta

Base homologada: 89cd9df6 (Quality Gate 45741159897, Chromium 45741159891).

A nova porta watchDirectChatPagesForOwner$ é aditiva, usa o callable paginado
existente, solicita janelas de 50 IDs e cancela gerações ao mudar revisão,
sessão ou autorização. A resposta de descoberta não autoriza leitura/envio.
Uma janela vazia pode ter continuação; os IDs são deduplicados, cursores
repetidos ou revisões divergentes são rejeitados. Erros limpam IDs e reiniciam
a consulta no próximo pedido explícito. A lista de cursores não é exposta.

Sem mudança nas Rules, quota, App Check ou fluxo legado. A ordenação do backend
por ID é intencional para incluir documentos sem timestamp. Não representa
ordenação global por atividade. Antes da troca da UI, auditar escritores de
timestamp e cobertura legada, projetar ordenação estável e manter leitura
individual confirmada por Rules. A contagem de não lidas continua no contrato
anterior (limite legado de 500 candidatos); não há certificação de escala
global nem mudança da projeção de notificações nesta subetapa.

Testes adicionados: janela vazia, deduplicação, exaustão, concorrência,
cancelamento por revisão, erro, reinício e resposta inválida.
CI necessária antes da ativação em UI; nenhum deploy.
