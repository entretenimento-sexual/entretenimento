# CHAT-R1.10.3.4.3C — Coalescência de consultas de descoberta em voo

Base homologada: 825d476769660dadf6034ba561c9ef3b389f82ef. Quality Gate agregado success (45818400473), Media E2E 45818400346, Chromium 45818400348 (17 cenários, 181/181 mensagens, artefato 15116483899). A homologação funcional não elimina a ocorrência residual HTTP 429: 60 respostas listDirectChatCandidates (A 31, B 16, D 13), uma 429 em A. Baseline 4.3A preservada: envio P50/P95 232/256 ms, alternância 119/218 ms, reconexão 2306 ms, recibos residuais 10 ms. Referência 4.3B 284/392, 155/246, 2839, 26 ms; reconexão volumosa 3787 ms, atualização realtime 449 ms, revogação 115 ms.

## Implementação
- Registry WeakMap por identidade da geração confirmada, com chaves distintas para autorização individual (chatId), descoberta global e página (cursor, ordem, limite).
- Coalescência exclusiva de requisições simultâneas. Remoção antes de emitir resultado/erro, também no teardown; sem cache de decisão concluída, TTL ou reutilização entre gerações/sessões. Revogação cancela consumidores e descarta resposta tardia. Promise de callable já enviada não é abortável.
- Cada consumidor valida o resultado canônico, os cursores e a revisão como antes; Rules continuam autoridade final. A página captura a identidade da geração antes da chamada, inclusive no transporte legado paginado. Não se mesclam contratos global, individual ou paginado.
- Tests determinísticos: 24 leituras concorrentes = uma fonte, leitura posterior = nova fonte; chaves distintas, revogação, mesma revisão com nova identidade, erro, teardown e reentrada. Testes de transportes existentes preservados.
- Chromium mantém 17 cenários e as métricas; registra delta de chamadas em relação a 60 e exige zero 429 da descoberta. Contagem total depende de timing e não constitui promessa de redução antes da evidência real.

Sem mudanças de quotas, backend, Rules, nomes públicos, dependências ou deploy. Esta etapa foca descoberta; otimização de polling de amizade e demais entradas intermodulares ficam para intervenção posterior com evidência. Não foi executada localmente. Se o 429 persistir, investigar chamadas sequenciais e invalidações (não mascarar com retries ou quotas maiores).
