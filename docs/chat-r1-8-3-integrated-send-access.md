# CHAT-R1.8.3 — disponibilidade integrada de envio e compartilhamento

Base: 18bac5af63cd88e27b6052aad7f840e17265fe88. Quality Gate 45661132554 e Media E2E 45661132309, ambos success; Quality Gate / aggregate success. Logs do job 139370936509: 17:16:42Z cache-only after logout exists=true e PASS EST-R1.5.1 explicit REST authorization, terminal listener revocation, SDK logout, A-to-C-to-A and independent B; 17:16:46Z PASS self-service deletion cancellation and public profile/avatar restoration; bilateral_block_e2e=success. Cache não concede autorização.

## Intervenção

- Chat selecionado usa observeForCurrentUser$(peer, owner), mesma porta reativa de Amizades/Discovery (user-card), perfil visitado e Media. Mantém a distinção entre histórico legível e envio autorizado; o gate canRunChatRealtime e a projeção versionada confirmada no servidor são cumulativos. Modal de mensagem mantém o contexto implícito de sessão já existente.
- Intent de envio não selecionado captura a identidade/epoch na criação, não ao assinar. Um observable frio do login anterior não adquire autorização no login novo, inclusive mesmo UID.
- Seletor de compartilhamento de vídeo observa chaves conversa+participante de forma incremental. Inclusão, remoção ou alteração de outra conversa não reinicia a observação existente. Remoção do próprio contexto, mudança de participante, perda de disponibilidade ou troca de sessão revoga a intenção e descarta resposta local tardia. Não muda seleção do Chat; a callable continua autoridade final e não se promete cancelar mensagem já confirmada.
- Acessibilidade: preserva botão nativo, grupo nomeado, estado desabilitado e rótulo de indisponibilidade.

## Limites e validação

Sem alteração de Rules, Functions, rate limits, fontes canônicas, rotas ou persistência. Comunidades e Notificações mantêm a navegação existente, sem inferir UID privado a partir de identificador público nem converter navegação/histórico em autorização. Nenhuma alteração nesses módulos, pois a intervenção incide na fronteira compartilhada de envio. Testes de regressão do facade e do seletor abrangem autorização, cold intent, revogação e concorrência de observadores. Nova CI obrigatória; homologação visual de navegador e carga multi-instância continuam pendentes. Não há deploy.
