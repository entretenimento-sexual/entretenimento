# CHAT-R1.10.3.4.3D.5 — Incremento 1: observabilidade e encerramento da admissão

Base: cebaa49, 10 workflows/21 jobs, 3393 Angular, 391 Firestore Rules, 69 fases Chromium, 302 tentativas (269 HTTP, 30 abortos, 3 falhas induzidas), 0 HTTP 429. A D.4.1 não garante convergência rápida sob saturação (até 59,108 s), e a admissão é consultiva, por origem. Não alterar quotas, autorização, limites de página nem regras.

## Implementado
Instrumentação opt-in pelo PrivacyDebugLoggerService, ID sequencial local à instância do repositório, direção e estados queued/waiting/admitted/expired/failed/cancelled/transport-started. ID não identifica usuário, revisão ou conteúdo. admitted indica liberação consultiva, inclusive fallback; transport-started é início lógico da callable, não confirmação de HTTP. Sinais repetidos de waiting não são operações distintas. Não persistir identificadores ou logs no produto.

Testes unitários para contabilidade, cancelamento do último consumidor (incluindo compartilhamento), expiração tipada. Cenário Chromium adicional, após seis cargas preservadas: contexto isolado, ledger saturado explicitamente como fixture, autenticação real, espera observada, logout antes da renovação, cancelamento por ID e zero transporte mesmo após renovação. Fixture não mede desempenho sob carga real. Artefatos separados; não usar a fixture para afirmar redução das consultas.

## Auditoria inicial intermodular
RequestsRepo é autoridade compartilhada de leitura de pendências por sessão/direção; FriendshipService delega às operações canônicas. VisitedProfileFriendshipFacade observa pendências, amizades e bloqueio; revalida ao mudar de perfil e mantém fail-closed. Não introduzir replay de autorização ou cache entre identidades para reduzir consultas. A eliminação de leituras adicionais depende de provar a equivalência de sessão, direção e época; não alterar a semântica de revalidação dos perfis neste incremento. Chat, Notificações, Comunidades, Perfis e demais consumidores devem ser auditados em incremento subsequente, com contabilidade separada e regressões.

## Certificação
Pendente CI. Sem homologação da D.5. Este incremento não resolve saturação multi-dispositivo, latência, nem encerra a consolidação intermodular. Não executar deploy.
