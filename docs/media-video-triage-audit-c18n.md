# c18n — Protocolo de reconciliação de movimentos e reparo dirigido

## Problema comprovado

Em uma varredura paginada por `state + documentId`, um job pode migrar
para uma faixa já examinada e desaparecer do inventário observado. Outro
job pode ser contado duas vezes. Mesmo os totais iguais e as duas leituras
estáveis de cada página não demonstram cobertura global.

c18n acrescenta uma **reconstrução causal em fixture confinada ao Emulator**.
Não executa consulta de produção, não altera nem relê processamento no
Transcoder, não cria schedulers, índices, endpoints ou flags.

## Contrato experimental de época fechada

`reconcileVideoTriageClosedEpochFixture` aceita:

1. Inventário inicial e inventário final independentes, com ID, estado
   e revisão de cada registro (limite de 20 IDs por inventário).
2. Páginas observadas por faixa, com cursores, IDs e indicador `hasMore`
   (máximo 100 páginas da fixture).
3. Manifesto de transições: `sequence` sem lacunas, ID, identidade anterior
   e posterior, abrangendo inclusões, alterações e exclusões
   (máximo 40 transições).
4. Informação de fechamento de escrita do *harness* local, com contagem de
   eventos e intervalo de observação.
5. Releituras direcionadas **após o encerramento** da janela de escrita,
   para cada ID ausente, modificado ou inserido que ainda exista no
   inventário final.

O reconciliador reproduz as transições, confere seu estado final
contra o inventário independente e rejeita eventos omitidos,
adulterados, repetidos ou fora de sequência. Uma duplicidade somente
pode ser explicada por uma transição registrada; omissões exigem
releitura final. Não aceita reparar um ID por meio de estado ou revisão
diferente da referência final. Faixa incompleta e cursor inválido
impedem confirmação.

As saídas são `FIXTURE_RECONCILED`, `REPAIR_REQUIRED` e
`INCONCLUSIVE`. Mesmo `FIXTURE_RECONCILED` **não valida produção**:
a declaração `allFixtureWritersFenced` é fornecida pelo próprio
ambiente de teste, não é certificação independente nem garante captura
de todos os escritores externos.

## Testes reproduzíveis

- Fixture estável: conclusão sem reparos, sem afirmar cobertura global.
- Duas mudanças entre faixas com totais aparentemente corretos:
  uma omissão e uma duplicidade, seguidas de duas releituras dirigidas.
- Inserção e exclusão durante a janela: reconciliação de eventos e
  releitura do novo ID final.
- Lacuna ou falsificação de sequência, estado/revisão anterior incorretos,
  testemunho de época ausente e página com faixa/cursor incompleto:
  todos inconclusivos.
- Limite de eventos excedido: rejeição antes de processar.
- Integração isolada com páginas efetivamente observadas pelo SDK no
  Emulator e releitura apenas das duas fixtures conhecidas. Outros
  documentos eventualmente encontrados na consulta tornam a
  evidência inconclusiva, não são silenciosamente descartados.

## Condições para uma prova operacional legítima

O registro de transições precisaria passar por **todos** os caminhos
de escrita que mudam o domínio observado, com sequenciamento,
fencing e proteção contra perda de eventos. A referência de início/fim
exigiria origem independente verificável, inclusive criação,
exclusão, troca de estado e atualização na mesma faixa. Em seguida,
a varredura/reparos precisariam respeitar orçamento de consultas
autorizado e custos reais medidos.

Não presumir que dois snapshots coletados em instantes diferentes
equivalem a snapshot consistente do Firestore. Se não houver
referência global ou captura exaustiva das mudanças, o resultado
operacional permanece `INCONCLUSIVE`.

Não converter esta fixture em `GLOBAL_CONSISTENT` no gate c18g.
Permanecem pendentes cobertura legada, vencimentos, índices READY,
controle completo de custos, os nove requisitos operacionais e decisão
explícita de ativação separada. **c19 bloqueada.**
