# CHAT-R1.10.3.4.3D.2.1 — Bootstrap e contingência direcional

Base certificada: a88dfb6 (Quality Gate, Media E2E e Chromium aprovados).
Carga original: 17 respostas de solicitações, 46 de descoberta, zero HTTP 429,
181 mensagens recuperadas; D.1: 21 e 45 respectivamente. A variação de uma
execução não é evidência de economia causal.

- Bootstrap: os listeners já fazem a primeira leitura canônica; remover as
  duas listagens pontuais concorrentes. Preservar o reset no fechamento do gate.
- Pós-mutação local: enviar/cancelar atualiza outbound; aceitar/recusar
  atualiza inbound. Aceite preserva atualização de amigos. Manter a leitura
  explícita da direção afetada como contingência, sem assumir que o snapshot
  chegou ou que o listener está saudável.
- Falha da callable: emitir a ação de falha existente e reinscrever após o
  intervalo de contingência já existente de 60s. Stop e troca de UID cancelam
  a espera. Não alterar polling, autorização ou quotas.

Certificação pendente do CI deste commit. Comparar a carga original separada
dos novos cenários, sem exigir igualdade determinística de contagens temporais.
Testar bootstrap, direção local e recuperação de falha/isolamento por UID.
Ainda pendentes: cobertura de bloqueio e ciclo de vida em solicitações,
contagem efetiva de leituras/escritas/triggers, concorrência e amostras
suficientes para fundamentar polling adaptativo. Não homologar D.2.1 ou D.3
antes das respectivas evidências.
