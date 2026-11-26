# CHAT-R1.10.3.4.3D.2.2 — Segurança e resiliência

Base homologada: 6e7816685757aea1a605fe243e33d70a50a9ae98. Implementação sujeita a CI; não é homologação.

Base: 194 tentativas, 155 respostas HTTP, 36 abortos, 3 sem desfecho; 13 leituras SPA por réplica sem abortos, 0 HTTP 429, 181 mensagens recuperadas por réplica.

Inspeção dos artefatos 15144893455 (R1), 15144698982 (R2), 15144978556 (R3): todos os três registros sem desfecho eram outbound de bootstrap de documento 2 na fase cancel-decline: mount, nos contextos receiver, sender, sender. O inbound simultâneo teve HTTP 200; novas leituras canônicas posteriores tiveram sucesso. Não há prova de resposta ou cancelamento dos três registros. Ausência de terminal não prova vazamento nem falha backend.

SessionReadInFlight observa authUser$ quando disponível, além de uid$, para liberar assinaturas retidas quando a autoridade de sessão emite outra instância. Mantém verificações de usuário, versão e encerramento; não promete abortar Promise do SDK. A emissão de troca de instância com mesmo UID depende do contrato AuthSessionService; não se altera comparador global.

Testes do repositório cobrem sucesso e erro tardios, troca de UID, listener único, encerramento, relógio da sessão nova e ausência de leituras após dois intervalos virtuais. Teste do effect cobre duas falhas consecutivas e recuperação no intervalo existente.

Carga Chromium independente resilience: contas sintéticas, callables reais, resposta real retida antes do logout e liberada após novo login, falha transitória controlada de transporte e recuperação, 65 segundos anônimo após logout final. Resposta antiga entregue e transporte cancelado são discriminados. Prova determinística complementar no teste unitário. Desconexão/reconexão e invalidação direcional continuam nas cargas anteriores.

Telemetria requestfinished recupera status efetivamente observado; marca fechamento sem evento terminal sem reclassificar por suposição. Sem payload, token ou UID nos novos registros. Cargas anteriores e nova carga separadas; legacyTotal comparável; all inclui resiliência.

Sem alteração de quotas, políticas, cache de respostas ou intervalo de 60 segundos. Sem deploy. Evidências pendentes do CI: resilience-samples.json, pending-read-accounting.json, pending-read-attempts.json e result.json.
