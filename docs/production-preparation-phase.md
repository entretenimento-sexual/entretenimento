# Fase de preparação para produção — roteiro preservado

Estado em 24/11/2026: fase adiada até conclusão da auditoria abrangente do módulo Chat e tratamento dos bloqueantes identificados. Não autoriza implantação.

Baseline operacional: `75b90c0e9a03f879f26ce24e585e1b52d1bfb9b9`; 22 testes operacionais aprovados, auditoria estrita de órfãos aprovada, reinicialização Windows com checkpoint e sessão pronta confirmadas pelo operador. QA de mídia documentado em `docs/qa/media-reactivity-manual-validation-20261124.md`.

| Ordem | Frente | Prioridade |
| --- | --- | --- |
| 1 | Implantação da marca institucional | P0 |
| 2 | Identidade visual e canais de contato | P0 |
| 3 | Segurança, privacidade e proteção de menores | P0 |
| 4 | Autenticação e ciclo de vida das contas | P0 |
| 5 | Moderação e controle de exposição das mídias | P0 |
| 6 | Performance, reatividade e custos Firebase | P1 |
| 7 | Tratamento centralizado de erros | P1 |
| 8 | Acessibilidade e responsividade | P1 |
| 9 | Dependências e código residual | P1 |
| 10 | Validação final para implantação | P0 |

## Diretrizes

Exclusivamente `main`, sem novas branches ou PRs, sincronização por fetch explícito e merge --ff-only; preservar nomenclaturas, Observables, acessibilidade, reatividade e tratamento centralizado de erros. Não enfraquecer regras de segurança. Exigir evidência de testes e validação operacional antes de liberar produção. Retomar este roteiro após o Chat; não considerar QA local uma certificação de produção.

## Requisito transversal do Chat (24/11/2026)

Reatividade de ponta a ponta é critério obrigatório de aceite: lista e thread, prévias, mensagens, exclusões, reações, recibos, badges individuais e globais, contadores de não lidas, notificações internas e push (sujeitas a entrega do sistema), mudanças de perfil, bloqueio/desbloqueio, amizade, revogação e restauração de acesso, logout e troca de sessão. Nenhum refresh manual para convergência da UI. Usar autoridade canônica, não contadores paralelos; garantir limpeza de dados antigos, cancelamento de listeners e teste em duas sessões. Validar a recuperação após bloqueios prolongados e o comportamento quando a aplicação está em primeiro/segundo plano. O requisito não implica que notificações push possam ser recolhidas após entrega pelo sistema operacional.

### CHAT-A5.1 — autoridade de não lidas (transição)

Recibos persistidos são a fonte canônica; o estado compartilhado em ChatNotificationService agrega somente snapshots autorizados. Badges do menu e da inbox usam o mesmo mapa por conversa; a abertura da thread não altera o contador. O caminho intermediário mantém uma consulta de mensagens não lidas por conversa autorizada, reaproveitada enquanto o par não muda. O custo e a escalabilidade desse modelo precisam ser medidos antes da produção. Não habilitar a projeção experimental nem declarar cobertura integral de bloqueio prolongado antes dos testes; a consulta ampla de chats ainda exige validação das Rules. A inbox continua limitada a sua janela atual de 50 conversas; o badge do menu representa a coleção consultada pelo serviço, e o subtotal da inbox representa os itens exibidos.

### CHAT-A5.2 — Central de Atividades

O atalho Mensagens consome a mesma contagem de recibos que o menu lateral e a inbox; não infere pendências a partir de notificações de chat. A Central conserva a autoridade de AppNotificationService (documentos de notificação), sem aplicar Math.max com a janela recente. A mudança de UID limpa imediatamente a lista e a contagem e cancela o Observable de agregação anterior antes da janela de coalescência. A contagem global de notificações ainda depende dos eventos da janela recente e das mutações locais: alterações remotas fora dessa janela exigem futura projeção agregada validada. Não somar mensagens com notificações nem marcar notificações como lidas por efeito colateral de recibos sem contrato explícito.

### CHAT-A5.3 — restauração e revogação

A projeção de abertura do chat exige snapshot confirmado pelo servidor; cache não autoriza nem aciona reconciliação. Lista e thread rejeitam snapshots exclusivamente em cache; paginação histórica usa leitura de servidor. Após a sequência finita de retries, o listener aguarda evento de reconexão ou retorno à aba visível, cancelado com a sessão. Isso não garante recuperação após bloqueio prolongado enquanto a aba fica continuamente visível: exige projeção de autorização de leitura independente da amizade e descoberta de conversas por usuário, sem flexibilizar Rules. A projeção direct_chat_access vigente inclui amizade e não pode governar a contagem do histórico após desfazer amizade. Notificações gerais e eventos push ainda exigem auditoria de revogação específica.
