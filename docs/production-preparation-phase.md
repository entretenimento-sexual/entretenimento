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

### CHAT-A5.4 — notificações internas

O total global usa uma única consulta compartilhada de todas as notificações não lidas do UID atual, sem depender da janela recente de 20 itens nem de refresh por mutação local. Cache não confirma leitura. O custo inicial cresce com o número de não lidas; medir antes de produção e substituir por projeção agregada validada se necessário. Marcar todas usa transações e corte fixo de criação/atualização; atividade nova não é consumida silenciosamente, e lote com item ignorado não declara conclusão total. Revogação por ator bloqueado exige política backend por tipo de notificação, preservando avisos legais e operacionais; não resolvida nesta etapa.

### CHAT-A5.5 — contexto de autorização da thread

A autorização observável contém UID, epoch, chatId e peer. A thread compara o identificador e UID antes de abrir ou executar comandos; não combina autorização booleana de um chat com seleção de outro. Removidos resíduos sintáticos das facades e restaurado loaded na leitura bem-sucedida. A sincronização integral entre sessões ainda requer execução dos testes, validação das Rules, recuperação prolongada e revisão das operações assíncronas de notificações.

### CHAT-A5.6 — Web Push

Worker exige vínculo ativo e identidade opaca estável do evento; alertas legados sem identidade são descartados. Conteúdo externo é neutralizado novamente no worker; tag estável substitui duplicatas ainda visíveis sem renotify. Clique exige vínculo atual e abre somente a Central autenticada, sem redirecionar aba arbitrária para deep link privado. Deploy coordenado backend/worker necessário: durante transição, alertas Web antigos podem ser descartados, mas documentos canônicos continuam na Central. Não garante deduplicação após dispensar alerta, nem revogação de push já entregue pelo SO. Supressão de qualquer aba visível e revalidação de lifecycle/bloqueio de chat no backend ainda precisam de revisão; não alterar registro de tokens nesta etapa. Teste isolado: npm run webpush:worker:test.

### CHAT-A5.7 — eficiência de leitura

Corrigido fragmento duplicado/incompleto em ChatRepository, preservando rethrow e leitura histórica de servidor. DirectChatService compartilha uma única instância de Observable da lista, com gate/UID distintos e refCount. O mapa de não lidas evita reemissões idênticas e não é reconstruído por simples mudança de preview. Não restringir query a senderId sem migração dos aliases legados. O modelo provisório ainda utiliza 1 listener de descoberta + N listeners de recibos (N conversas), além da lista paginada e thread ativa; total geral de notificações também lê todos os documentos não lidos. Esses limites são bloqueadores de escala a validar em A5.8, não uma solução final. Sem estimativa monetária sem medições reais. Compilação e homologação pendentes.

### CHAT-A5.8.8 — governança de ativação

Contrato puro de decisão com bloqueio estrutural da projeção experimental e retorno a RECEIPTS em qualquer condição inválida. Shadow não alimenta a UI. Não há switch operacional ativo. Exigir homologação, cobertura completa, reconciliação incremental, autorização global reativa e rollback real antes de conectar o contrato ao runtime. Ver docs/architecture/direct-unread-backfill-readiness.md.

### CHAT-A5.8.9 — revisão de homologação

Lista compartilhada transporta ownerUid antes de replay; facade rejeita snapshot de outra sessão e limpa a lista na transição. Mantida API getMyDirectChats$. Identificador documental prevalece na paginação de mensagens. Testes de auditoria não transacional atualizados para INCONCLUSIVE; teste de replay entre UIDs adicionado. Não substitui listeners por projeção. Compilação, testes unitários, Rules e integração emulador ainda precisam ser executados no checkout. Não declarar homologação concluída.

### CHAT-A5.9 — CI recovery

Quality Gate run 45454233878 on 42295701: 8/13 checks successful; Functions lint/build-tests, Angular tests/build and chat reconciliation failed. Corrected reported TypeScript index signature access and optional chat ID, 36 reported lint issues, outdated worker navigation tests and missing simulated App Check in delete-message integration fixture. No security checks disabled. Re-run CI before further feature work; no projection activation or production deployment.

### CHAT-A6.1 — exclusão lógica e minimização de conteúdo

Base Quality Gate 08d762ca aprovado. Exclusão valida a estrutura canônica de conversa direta antes da existência da mensagem e rejeita aliases conflitantes de autoria. Tombstone remove referência de vídeo e reações por FieldValue.delete e normaliza messageType, incluindo preview identificado pelo ID exato; retry autorizado saneia tombstone legado sem alterar deletedAt/deletedBy. Mantido direito de apagar mensagem própria após bloqueio; status explícito inativo segue política estrutural de envio. Previews sem messageId não são inferidos por texto. Não há varredura retroativa ou revogação de mídia original; pendentes A6.3/A6.6. Testes adicionados, aguardando CI.
