# CHAT-R1.7.4 — Auditoria dos pontos de entrada

Base: CHAT-R1.7.3 (9d1d3738). Regra de produto: leitura de histórico não concede envio. Nenhum cliente concede autorização definitiva; Rules e callables continuam soberanas.

| Superfície inspecionada | Caminho | Decisão |
| --- | --- | --- |
| Pessoas | public-profiles-list -> app-user-card | Reutilizar autorização bilateral R1.7.3 |
| Online | online-users -> app-user-card | Reutilizar autorização bilateral R1.7.3 |
| Amigos | friend-cards -> app-user-card | Reutilizar autorização bilateral R1.7.3 |
| Perfis | other-user-profile-view -> startDirectChat | Preservar autorização bilateral R1.7.3 |
| Comunidades | community-members-page -> /perfil/:profileId | Preservar identidade pública; não tratar memberKey/profileId como UID privado nem criar atalho com identificador inadequado |
| Mídias | public-video-chat-share-dialog -> sendDirectVideoReference | Corrigir uso de canOpen como permissão de envio; observar escopo canônico + disponibilidade bilateral, sem alterar seleção do Chat |
| Notificações | user-activity-hub -> /chat; notification-navigation.policy | Preservar navegação de leitura; openChatId é uma solicitação, não uma concessão de acesso |
| Modal | modal-mensagem -> ensureDirectChat -> sendMessage | Revogar definitivamente o contexto implícito ao mudar a sessão |

A lista do compartilhamento permanece visível quando houver histórico, mas o envio requer autorização confirmada. Revogação cancela o resultado local pendente; a callable já despachada continua protegida pelo backend. Não se promete desfazer um envio já confirmado.

Limitações: busca de código remota não retornou ocorrências; inspeção foi direcionada aos arquivos e templates conhecidos. A cobertura de todas as superfícies independentes e restauração de atalhos históricos ainda requer inventário local abrangente, incluindo git log, e QA de duas sessões. Não criar consultas por UID a partir de identificadores públicos de comunidade. CI deve validar mudanças antes da próxima etapa.
