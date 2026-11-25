# CHAT-R1.9 — Certificação operacional integrada (etapa automatizada)

## Base homologada
d84a2e4db51ab97a4b20ca6a349d3e0e66832c2e: Quality Gate 45669329033 (aggregate success), Angular 3319/3319, Functions 2213/2213, Rules 390/390, reconciliação Chat e E2E bilateral success, EST-R1.5/1.5.1 PASS. Discovery Visual 45669328969: dev-emu, development e production success. Evidência production: artefato 15048864136.

## Cobertura obrigatória
- Auth, Chat, Amizades, Discovery e Media: E2E bilateral e revogação administrativa permanecem intactos; novo envio autorizado após A→C→A, leitura independente por B e negação REST a C/anônimo.
- Media: a suíte real de callables de revogação (suspensão, bloqueio, hold, despublicação, métricas) passa a integrar o agregado.
- Comunidades e Notificações: criação, descoberta, mural, ações e revogação de membership passam a integrar o agregado. A notificação real produzida por comentário é lida por destinatário e negada ao ator e anônimo via Rules; a perda de membership mantém a negação de escrita no destino.
- Cada nova etapa usa comando canônico, emuladores descartáveis sequenciais, pipefail, logs separados e outcome obrigatório. Skipped, failure ou ausência de sucesso falham o agregado. Sem mudanças nas Rules, Functions, permissões, rate limits ou código de produção.
- Angular e testes de acessibilidade/reatividade existentes continuam obrigatórios; nenhum teste é removido. Não se confunde SDK/REST com interação visual em navegador.

## Limites
Esta intervenção implementa a cobertura automatizada, não declara a certificação concluída antes da CI. As suítes novas no gate não foram executadas localmente nesta sessão. A fixture de membership é administrativa; os callables e leituras são reais. A auditoria visual de Discovery não substitui teste E2E de navegação em todas as telas. Carga multi-instância, consumo de listeners/latência e QA de navegador real A/B/C (incluindo foco, anúncios aria-live, logout e revogação durante interação) continuam pendentes, conforme docs/est-r1-integrated-homologation.md. Não houve deploy.

## CHAT-R1.9.1 — Correção do ambiente de certificação

CI 45672143789 / commit bdbbe9b7: aggregate failure em community_interaction_e2e. Logs: 18:17:16 UTC, assertFirebaseEmulatorDependenciesConfigured rejeitou ausência de FIREBASE_STORAGE_EMULATOR_HOST; Functions não carregou e getCommunityTagCatalog retornou 404. Nenhuma asserção nova de Comunidades/Notificações foi atingida. Angular 3319/3319, Rules 390/390, fila de exclusão 1/1, reconciliação Chat 96/96, novo envio A→C→A e todos os callables Media passaram; workflows Media E2E e reconciliação de vídeo aprovados (168/168 transações). A correção inicia Storage no comando canônico de Comunidades e exige os endpoints efetivos de Auth, Firestore e Storage e hub, além de projeto demo, em ambos os scripts. Não altera guard de produção, Rules, permissões, asserções de negócio ou critérios do agregado. Nova CI obrigatória; não executado localmente.

## CHAT-R1.9.2 — Alinhamento do E2E à política de recomendações

CI 45674311902 / 847c3574: cinco workflows aprovados, agregado failure em community_interaction_e2e. Storage iniciou junto de Auth, Firestore e Functions; getCommunityTagCatalog e createCommunity executaram. Falha em community-creation.e2e.mjs:547: expectativa de que a comunidade apareça em Explorar para seu proprietário. A política filterCommunityRecommendationCardForViewer exclui participantes ativos e pendentes (community-preview.model.ts e seu teste unitário); Minhas Comunidades já retornou a criação. O teste agora exige ausência para proprietário e membro ativo e presença/sanitização para visitante autenticado sem membership, inclusive depois da edição. Nenhuma mudança de produção ou redução de segurança. As novas asserções de notificação ainda não foram atingidas. Nova CI obrigatória; sem execução local.
