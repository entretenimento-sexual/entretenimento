# 1C2-A3b2b2c18w — Auditoria da cobertura dos escritores de processamento

## Achado

A auditoria estática depois da c18v contabilizou 43 sites de escrita direta
em 11 arquivos de produção: 29 estágios de mutação, 1 de criação e 13
escritas de manutenção de lease, polling, reserva, provedor ou projeção.
Contagens são sites no código, NÃO transações produtivas observadas.

## Matriz classificada

| Escritor | Sites | Mutação | Criação | Sem evento |
| --- | ---: | ---: | ---: | ---: |
| Fila de processamento | 3 | 2 | 1 | 0 |
| Processamento principal | 8 | 7 | 0 | 1 |
| Reconciliação | 10 | 3 | 0 | 7 |
| Commit terminal | 2 | 2 | 0 | 0 |
| Recovery administrativo | 2 | 2 | 0 | 0 |
| Source probe | 5 | 3 | 0 | 2 |
| Immutable preflight | 5 | 3 | 0 | 2 |
| Serviço Emulator | 2 | 2 | 0 | 0 |
| Exclusão de perfil | 1 | 1 | 0 | 0 |
| Backfill de triagem | 1 | 0 | 0 | 1 |
| Exclusão de conta | 4 | 4 | 0 | 0 |
| **Total** | **43** | **29** | **1** | **13** |

## Medida implementada

O novo contrato usa parser TypeScript, reconhece métodos Firestore em refs
conhecidas, classifica cada patch, exige presença de staging dentro do
mesmo callback transacional e controla a quantidade de eventos por arquivo.
Fixtures negativas verificam que novos sites e a remoção do staging
fazem o contrato falhar. Continua valendo o inventário c18o que bloqueia
novos arquivos referenciando explicitamente a coleção.

## Limitações que permanecem abertas

A inspeção sintática não prova a execução de todos os branches, não captura
aliases dinâmicos ou sistemas externos, não reconstrói jobs históricos e
não mede preço real, latência, retenção nem uma ordem total do outbox.
O teste de Emulator de transações segue sendo indispensável para os
casos de cancelamento, versões obsoletas e rollback.

Neste recorte não foi encontrada transição nova inequivocamente sem
outbox. Nenhuma escrita de produção foi ampliada apenas para aumentar
eventos ou consumo Firestore.

globalCoverageVerified=false; globallySequenced=false;
productionCostVerified=false; cleanupAuthorized=false.
c19, sequencing global, consumidor, TTL, deploy e flags continuam bloqueados.

Próxima intervenção sugerida: c18x, ensaios adversariais em branches
dinâmicos no Firestore Emulator e prova de reconciliação em época fechada;
isso não certifica cobertura de produção.
