# EST-R1.5.1 — credenciais, cache e autorização na homologação bilateral

Base 64531b13, Quality Gate run 45659057349 / job 139363595165: aggregate failure em bilateral_block_e2e; Media E2E aprovado. Log 17:04:26Z: Missing expected rejection em bilateral-block-two-sessions.e2e.mjs:464. O erro ocorre no laço imediatamente após signOut, sem indicar qual documento respondeu nem metadados ou credencial de transporte. Não prova bypass de Rules, nem demonstra sozinho que a causa seja exclusivamente cache. O step usa continue-on-error; consultar outcome agregado, não apenas conclusion do step.

## Separação das autoridades

- Auth.currentUser null confirma estado do Auth local, não a convergência do RemoteStore. O Firebase JS SDK encaminha mudança de credencial por AsyncQueue. getDocFromServer usa o mecanismo de watch e pode compartilhar um alvo ativo; não é garantia de RPC independente.
- A aplicação usa AuthSessionService.beginTermination para mascarar uid$ imediatamente e encerra listeners operacionais; o E2E Node não instancia essa camada Angular. Logout local não revoga globalmente todos os ID tokens válidos de uma conta.
- A prova independente de autorização usa GET REST no mesmo emulador demo, sem header após logout, ou com o ID token explícito do titular/conta C. Sem token owner, sem Admin SDK para as leituras de prova, sem retry, 200 e nome do documento no positivo; 403/PERMISSION_DENIED no negativo. Admin apenas prepara fixtures. Não se infere segurança de uma leitura do cache.
- A prova de convergência usa listener privado confirmado pelo servidor antes da transição, depois erro terminal permission-denied dentro do prazo existente. Também exige revogação dos três listeners antigos de Chat, Media e blocks no logout. A seguir, cada getDocFromServer privado deve falhar exatamente uma vez com permission-denied. Os positivos exigem !fromCache, !hasPendingWrites e documento existente. Nenhuma leitura indevida é aceita como condição de retry. O diagnóstico getDocFromCache não expõe conteúdo e não constitui autorização.
- C tem controle positivo do resumo próprio e negativo de todos os documentos privados de A. Na troca direta C -> A, o listener do resumo C deve terminar, o resumo C é negado via REST e SDK, e A recupera as seis leituras. B permanece independente. O cenário posterior de exclusão/cancelamento não foi removido.

## Limites e reprodução

Sem modificação de Rules, Firebase Auth de produção, quotas, contratos, Angular, ou configuração do emulador. Não há sleep arbitrário, limpeza artificial de cache, reinicialização do SDK ou tolerância a sucesso indevido nos testes de autorização. O prazo de convergência não é autorização para mostrar dados durante a transição; isolamento imediato da interface continua responsabilidade da camada reativa e dos testes Angular. O diagnóstico original não inclui traço do token no wire; a hipótese de compartilhamento de target/propagação é testável, não causa provada retrospectivamente.

Reprodução: npm run test:friendship:bilateral:e2e, no emulador descartável, portas livres. A aprovação da nova CI é necessária para certificar a correção e liberar CHAT-R1.8.3. Homologação visual e carga multi-instância seguem pendentes.

Referências públicas: https://firebase.google.com/docs/firestore/use-rest-api ; https://github.com/firebase/firebase-js-sdk/blob/main/packages/firestore/src/api/credentials.ts ; https://github.com/firebase/firebase-js-sdk/blob/main/packages/firestore/src/core/firestore_client.ts .
