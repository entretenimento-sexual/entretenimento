# 1C2-A3b2b2c18m — Conciliação de cobertura e observação de custo no Emulator

## Autoridade e limites

c18m é uma verificação **manual, offline e confinada ao Firestore Emulator**.
Não acrescenta endpoints, execução automática, novos acessos ao Transcoder,
varreduras operacionais de produção, escrita em jobs nem ativação de ordenação
global. Mantém c19 bloqueada.

O método `reconcileVideoTriageFixture` recebe duas listas **independentes**
de documentos da fixture (antes/depois, com estado e revisão) e páginas
efetivamente observadas pelo SDK. Os registros têm limites rígidos de 20 IDs
e 100 páginas, sem geração de relatórios contendo IDs de usuários ou jobs.

O comparador mede IDs ausentes, duplicados, não esperados, mudanças entre as
duas referências e violações de cursor. O caso de dois jobs que trocam de
faixa permite `observedTotal === baselineSize` com uma omissão e uma
duplicidade. Uma fixture estável completamente percorrida pode ter o estado
`FIXTURE_RECONCILED`, **nunca** `globalCoverageVerified=true` em produção.
Uma mudança de estado/revisão ou uma faixa não examinada permanece
inconclusiva; um cursor inválido nunca comprova cobertura.

O observador opcional de `auditVideoTriageConcurrentPage` exige
`FIRESTORE_EMULATOR_HOST` local e banco padrão, e registra somente dentro
do processo de teste os IDs consumidos, número de chamadas de query,
documentos retornados e quantidade solicitada em `getAll`. A versão
operacional da página permanece inalterada sem observador.

O observador opcional do journal registra chamadas ao SDK:
`TX_ATTEMPT`, `TX_GET`, `TX_WRITE`, `DIRECT_GET`. Pode distinguir
tentativas de transação, conflito/reexecução, leituras de recuperação e
status. Os eventos não carregam tokens, IDs, dados de jobs nem URLs.

**Estas medições representam tentativas de chamadas e documentos devolvidos
no Emulator, não um demonstrativo de cobrança do Firestore.** O SDK pode
executar retentativas, leituras mínimas faturáveis e trabalho interno que
não correspondem diretamente aos contadores. Leituras externas ao percurso
instrumentado também não são cobertas. A política da c18l mantém o estado
`MEASUREMENT_REVIEW` e `productionCostVerified=false`.

## Testes e critérios

- Fixture estável versus fixture com mudanças: comparação independente de
  IDs, revisões e faixas, com casos de cursor válido e inválido.
- Mutações adversariais: troca de faixas gera uma omissão e uma duplicidade
  apesar de totais iguais.
- Reserva: mesmo com concorrência, uma única tentativa obtém claim válido
  e os tetos do journal e dos jobs permanecem consistentes.
- Medição: instrumentação real de chamadas ao SDK no Emulator, sem exposição
  dos identificadores e sem confundir com conta financeira de produção.
- Contratos defensivos: nenhuma ativação de ordenação global, sem deploy,
  sem scheduler, sem alteração de objetos originais ou derivados publicados.

## Pendências antes de comprovação operacional

Faltam um protocolo de observação **globalmente consistente** sob alterações
concorrentes, medições de consumo em ambiente autorizado e custos faturados,
cobertura legada e vencimentos temporais, confirmação dos índices READY e
revisão independente dos nove critérios de prontidão. A c18m não substitui
nenhuma dessas evidências.
