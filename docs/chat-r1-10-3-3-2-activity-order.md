# CHAT-R1.10.3.3.2 — Ordenação canônica da descoberta progressiva

Base homologada 8f51a7a5 (Quality Gate 45742536746; Chromium 45742536776).

Auditoria: ensureDirectChat inicializa timestamp; os envios canônicos de texto
e vídeo atualizam timestamp, lastMessageAt e updatedAt atomicamente com a mensagem.
Excluir mensagem atualiza a prévia/updatedAt, não a posição da última atividade.
O índice chats (participants CONTAINS, timestamp DESC, __name__ DESC) já existe.

Novo contrato aditivo: {pageSize, cursor?, order: "activity"}. Ordenação indexada
por timestamp Firestore completo e ID descendente. Ao terminar registros
datados, a segunda fase percorre janelas por ID e inclui somente registros
sem timestamp válido, inclusive null e tipos incorretos. Não inventa horário
para históricos legados. A janela complementar pode estar vazia e continuar.
Os tokens opacos são vinculados ao proprietário, revisão, ordem e pageSize;
versão 2 incompatível com o cursor legado versão 1. Cada janela mantém
autorização bilateral e de lifecycle em transação read-only. A porta progressiva
já homologada solicita a nova ordem; nenhum consumidor visual foi ativado.

Limitações: a ordem vale para registros datados no instante de cada consulta;
não é snapshot global entre páginas. Uma mensagem concorrente pode mover o
registro antes do cursor. A integração visual deve deduplicar e reordenar
snapshots carregados, oferecer atualização da geração e validar concorrência.
A fase complementar pode escanear novamente registros datados; não é uma
projeção de cobertura legada otimizada. Contagem global de não lidas e
escala ainda não migradas. Não altera Rules, quotas, índice, deploy ou
comportamento da lista legada.

Certificação: teste de emulador com precisão submilissegundo, empate por ID,
históricos ausentes/nulos/inválidos, bloqueio, cursor cruzado/estrangeiro e revisão.
