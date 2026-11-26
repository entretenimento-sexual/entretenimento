# CHAT-R1.10.3.3.3 — Caixa de entrada progressiva

Base homologada 56f1fd5c. Referência funcional: WhatsApp (atividade, continuidade
e confirmação de mensagens), Instagram Direct/Messenger (integração social),
Telegram (históricos extensos). Não se presume paridade integral, nem E2EE.

A inbox usa a porta paginada de 50 candidatos; cada ID é materializado por
snapshot confirmado de Rules. Listener incremental preserva chats já carregados,
reordena por timestamp canônico e inclui históricos sem data válida ao final.
A seleção e o histórico seguem a autoridade individual já homologada. Busca
é local às páginas carregadas; feedback explícito, continuação vazia, atualização
manual e retry sem limpar seleção. Contagem de não lidas deriva do estado global
já existente, não das páginas. Controles de 44px e região status.

Limitações: conversas ainda não carregadas que recebem nova atividade podem
mudar antes do cursor; atualizar reinicia a descoberta. Não há invalidation
global por mensagem nesta etapa; evitar fanout de revisões por envio. A contagem
global legada ainda tem limite de 500 candidatos, sem ativar projeção não
certificada. Consumidores antigos (Media, store, notificações) seguem legados;
otimização e cobertura global pendentes de CHAT-R1.10.3.4/5.
Não muda Rules, quotas ou produção. Testes unitários e navegador devem confirmar
paginação sem perda do rascunho, seleção, revogação e reordenação.
