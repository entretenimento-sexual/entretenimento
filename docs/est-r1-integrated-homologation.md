# EST-R1.5 — homologação integrada

Base: fdd21da8. Quality Gate / aggregate, Media E2E e Video Reconciliation Firestore Emulator aprovados (runs 45652723178, 45652723574 e 45652726388). O Quality Gate também aprovou Angular, Firestore Rules, reconciliação de Chat e E2E bilateral.

## Extensão executável

O teste canônico `scripts/tests/bilateral-block-two-sessions.e2e.mjs`, já chamado pelo Quality Gate via `npm run test:friendship:bilateral:e2e`, passa a verificar:
- A autenticada, logout, C autenticada no mesmo SDK e retorno direto a A; B continua em cliente independente.
- Leitura exclusivamente do servidor (não cache) de documentos privados de Chat, Media, Amizades, notificações e resumo de Comunidades, negada no logout e na conta substituta, restabelecida para o titular.
- Resumos distintos por usuário, sem confundir a projeção de um com a do outro. Os documentos são fixtures Admin; isso testa autorização de leitura, não produção da notificação.
- Callables reais de solicitação e cancelamento de exclusão; retirada e restauração do perfil público e avatar observados por B, preservando a mensagem anterior.
- Sem alteração de código de produção, Rules, quotas, contratos ou deploy. Projeto demo descartável, sem dados pessoais reais.

## Homologação operacional ainda necessária

A aprovação da nova CI é pré-requisito, não substituto da homologação em navegador. Executar em ambiente local preservando o snapshot do desenvolvedor, duas sessões independentes e contas sintéticas A/B/C:
1. Chat/Amizades: conversa aberta, enviar/receber, bloquear/desbloquear bilateralmente; ocultar ação indisponível e recuperar sem recarregar.
2. Media/Discovery: abrir foto e vídeo, revogar acesso durante reprodução e requisição, reativar apenas após confirmação canônica; conferir perfil e cards.
3. Comunidades/Notificações: mural, membership, contador e resumo; troca de conta deve limpar a apresentação antiga antes de nova leitura.
4. Auth: logout, A→C→A, exclusão pendente/cancelamento; checar telas abertas na outra sessão, sem refresh.
5. Verificar console, erros centralizados, ausência de dados antigos, requests repetidos, latência e contenção. Registrar evidência por cenário e SHA.

EST-R1.2: a auditoria estática não mede toda concorrência em runtime. EST-R1.3: carga real multi-instância e latência/contensão ainda exigem evidência quantitativa. EST-R1.5 não fecha essas pendências por inferência. Sem homologação de navegador nem carga multi-instância neste commit. CHAT-R1.8.3 permanece condicionado à aprovação e à triagem dos bloqueios.

## Reprodução

`npm run test:friendship:bilateral:e2e` (usa emuladores descartáveis próprios; verificar que as portas do config firebase.media-e2e.json estão livres).
`npm run test:community:e2e` (cobertura adicional de criação e descoberta de Comunidades, não executada nesta intervenção).
