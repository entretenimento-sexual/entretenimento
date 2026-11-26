# CHAT-R1.10.3.4.3B — Certificação de histórico volumoso e integração

Base homologada: 9d4c779d48ec628b893cb405522c744ce50d6e44. Quality Gate 45813552505 (aggregate success), Chromium 45813552581, Media E2E 45813552529. Baseline confirmada no result.json do artefato 15114198896: envio P50/P95 232/256 ms, alternância 119/218 ms, reconexão 2306 ms, convergência residual dos recibos 10 ms.

## Novos cenários executáveis

Mantêm-se os onze cenários e a coleta 4.3A, na mesma ordem, antes da ampliação. O relatório inclui baseline imutável, deltas descritivos (ms, sem gate de regressão baseado em amostra pequena) e métricas de histórico separadas.

- Após fixture de amizade A/C, perfil público real abre conversa por ação Conversar, respeitando o callable e as autorizações da aplicação.
- 104 documentos históricos sintéticos + mensagem canônica inicial: janela inicial de 60, páginas de 20/20/5, ordem e IDs exatos, timestamps empatados, fim da paginação e preservação do draft.
- Envio real pela UI após carregar todas as páginas: 106 mensagens exatas, sem perder histórico anterior.
- Reentrada na conversa, interrupção somente do contexto A e inserção atômica de 75 documentos sintéticos no emulador. Recuperação sem reload após reconectar; ação de lacuna quando disponibilizada pela aplicação, paginação normal se a geração foi reiniciada. A recuperação deve resultar exatamente nos 181 IDs canônicos, em ordem, com limites de tentativas. O relatório separa número de páginas de lacuna e de histórico. Não se exige que a UI retenha dados privados após invalidação de geração.
- Bloqueio pelo callable real após materializar todo o histórico; retirada dos documentos privados do DOM e da conversa da inbox, mantendo o chat independente de B.
- Mantêm-se ausência de pageerror, isolamento de contas, mobile, notificação e recibos do cenário anterior. Os workflows Media E2E e Quality Gate continuam obrigatórios.

Fixtures Admin pré-lidas são exclusivas de emulador descartável e não certificam throughput de envio/recibos de 181 mensagens nem geração de notificações. O novo ponto de entrada real é Perfil/Amizades; a criação de amizade é fixture, não homologação de solicitação pela UI. Comunidades e Mídia continuam sob E2E existentes, sem alegar novos pontos de entrada em navegador nesta intervenção. Nenhum código produtivo, política, quota, dependência ou configuração de deploy alterado.

Limite funcional de 60 s por operação medida preservado. Métricas reais desta versão dependem da execução do runner; a certificação não foi executada localmente. Próxima etapa após aprovação: avaliar resultados e acrescentar entradas intermodulares reais restantes, além da decisão de integrar o Chromium como requisito canônico.
