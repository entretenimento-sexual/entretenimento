# CHAT-R1.10.3.4.1c — Compartilhamento com inbox paginado

Base homologada: 5f16bce8, Quality Gate 45801992172 e Chromium 45801991972.

O inbox progressivo passa a capturar a identidade da geração confirmada antes de iniciar sua própria cadeia de autorização paginada. Cada página continua sendo obtida de listDirectChatCandidates, com validação de revisão e cursor. Apenas IDs autorizados pela própria página podem se associar ao registro de snapshots compartilhados com descoberta legada e conversa individual.

A mudança de geração cancela a paginação anterior, limpa a projeção e encerra suas inscrições. A perda de confirmação resulta em lista vazia; a troca de conta ou revogação resulta em escopo revogado. O mesmo número de revisão não permite reutilização de uma geração antiga. A chegada de uma página adicional conserva listeners válidos da geração atual. A atualização explícita reinicia a autorização paginada sem conceder acesso por replay.

Assinaturas públicas, ordenação por atividade, tratamento centralizado pelo ApplicationErrorService e Firestore Rules preservados. Nenhuma mudança em mensagens, recibos, UI, Functions, Rules ou produção.

Testes adicionados: três consumidores e contagem do transporte, autorização independente, paginação incremental, descarte de página atrasada, revogação, troca de conta e retorno com revisão numericamente idêntica. A execução da CI do novo commit é necessária para homologação; a contagem é unitária e não representa uma medição de faturamento do Firestore.
