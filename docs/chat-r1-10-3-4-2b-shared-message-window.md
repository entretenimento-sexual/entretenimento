# CHAT-R1.10.3.4.2B — Compartilhamento autorizado da janela de mensagens

Base homologada: 6b5f67fe (Quality Gate 45805865158, Chromium 45805865194).

A entrada existente ChatService.monitorChat continua reativa e exige a identidade da sessão. O transporte da janela de 60 mensagens agora passa por ChatRepository.watchDirectMessagesForOwner$, associado à revisão confirmada de direct_chat_discovery. Cada consumidor executa listDirectChatCandidates com o ID individual, independentemente dos demais; só a janela de mensagens é compartilhada, após resultado exato de autorização, pela identidade do objeto de geração e ID do chat. Nenhuma decisão de autorização é cacheada ou compartilhada. O repositório de mensagens e as Rules continuam como autoridade de transporte e leitura.

Uma revisão nova, perda de confirmação, troca de proprietário ou revogação cancela a decisão pendente e limpa a janela anterior. O último unsubscribe e o erro removem o replay do transporte. Não se reutiliza resultado de uma geração anterior, mesmo com revisão numérica idêntica. A interface existente recebe [] durante revalidação, mantendo o contrato de limpeza fail-closed. A recuperação de transporte e diagnóstico canônico da facade/ChatService permanecem.

Testes exercitam autorização independente (inclusive consumidor negado), partilha física, cancelamento de decisões tardias, revisão numérica repetida, mudança de sessão, erro e teardown. A paginação histórica e as regras de recibos permanecem inalteradas. Há custo adicional de uma checagem individual por consumidor e revisão: não se afirma economia líquida de leituras sem medição. Nenhuma alteração de UI, Rules, Functions ou implantação. A CI deste commit deve certificar a mudança; coordenação global de recibos permanece para 4.2C.
