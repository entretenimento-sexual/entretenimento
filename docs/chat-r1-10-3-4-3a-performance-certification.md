# CHAT-R1.10.3.4.3A — Evidência de desempenho e estabilidade

Base homologada: b095e12f (Quality Gate 45811102170, Chromium 45811102148).

Esta primeira intervenção da certificação 4.3 acrescenta cenários executáveis à infraestrutura de Chromium e à suíte Angular, sem alterar código produtivo, políticas, permissões ou dependências. A topologia continua descartável, projeto demo, endpoints loopback e bloqueio de tráfego externo. Não há deploy.

## Cenários e evidência

- Oito envios sequenciais pela UI real, alternando A/B e clique/Enter, abaixo da quota existente. Ambos os contextos devem apresentar cada mensagem, exatamente uma vez e na ordem esperada; o Firestore do emulador deve confirmar status read para todas.
- Interrupção de rede apenas em B, envio de nova mensagem em A e recuperação em B sem reload explícito. Ausência de duplicação.
- Depois do teste original de C sem acesso, criação de amizade sintética A/C e segunda conversa pelo callable; seis alternâncias pela lista real com verificação de seleção, presença do histórico correto, ausência do outro e independência de B. A amizade é fixture Admin; não certifica fluxo de amizade pela UI.
- Mantêm-se as verificações anteriores de deep link de notificação, paginação, bloqueio bilateral, isolamento A/C/A, mobile, nome acessível, alvo de toque e ausência de exceções de página.
- Testes determinísticos de 200 operações em quatro ciclos de 50 recibos, cinco operações observadas simultâneas, FIFO e teardown; 24 consumidores em duas conversas e seis gerações de revisão, com duas fontes ativas por geração e descarte das anteriores.

O result.json do browser inclui amostras de tempo monotônico em ms, p50/p95 descritivos de envio/recepção e alternância, tempo de recuperação após reconexão e convergência dos recibos após o lote. Orçamento inicial de 60 s por cenário medido é limite de certificação funcional de CI, não SLO de produção. O tempo de recibos é residual após renderização do lote, não latência individual de leitura. Não se afirma p95 representativo de população, economia faturada, carga de produção ou desempenho de todos os módulos. Dados são sintéticos, sem telemetria de usuários.

## Homologação

A CI do novo commit precisa aprovar os testes; nenhuma medição real desta versão é alegada antes do artefato do runner. Próxima subetapa 4.3B: revisar evidência real, ampliar carga/reconexão/paginação sob histórico volumoso, avaliar os pontos de entrada entre módulos e estabelecer baseline comparável antes de definir SLOs. O Quality Gate agregado continua exigido juntamente com o workflow de Chromium.


## Homologação 4.3A — 9d4c779d

Quality Gate 45813552505 (aggregate success), Chromium 45813552581 (11 PASS, artifact 15114198896), Media E2E 45813552529 (foto e vídeo success). Result.json: envio/recepção 8 amostras P50 232 ms, P95/máximo 256 ms; alternância 6 amostras P50 119 ms, P95/máximo 218 ms; reconexão 2306 ms; convergência residual de recibos 10 ms. Mobile 390/390 px, botão 46 px, nome acessível. Sem exceções não tratadas de página. Valores de ambiente demo, não SLO.
