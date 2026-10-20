# 1C2-A3b2b2c18o — Proveniência dos escritores do inventário de vídeo

## Resultado da auditoria de código

**Não foi identificada uma fonte canônica comprovadamente completa de mutações
da coleção `media_video_processing_jobs`.** Em particular, o journal da c18j
(`media_video_triage_audit_sessions`) guarda tentativas de leitura da auditoria,
não eventos de escrita dos jobs. A projeção transacional da c18d, ainda que
consistente com o after-image do respectivo escritor, tampouco equivale a um
histórico de criação, atualização e exclusão.

O código contém múltiplos escritores diretos ou indiretos:

| Caminho | Escrita observada | Evidência/limitação |
| --- | --- | --- |
| queue-video-processing.handler.ts | criação, solicitação de cancelamento | criação e update transacionais; não há outbox global de mutações |
| video-processing.handler.ts | claim/submissão/retry/estado | versão e projeção acopladas à transação, sem change feed global |
| video-processing-reconciliation.firestore.ts | atualizações e exclusão em cancelamento | `transaction.delete(jobRef)` elimina o documento |
| video-processing-terminal-commit.firestore.ts | commit terminal | projeção no mesmo commit; nenhuma sequência global observável |
| admin-video-processing-recovery.handler.ts | recriação/retry/mutação administrativa | updates e auditoria administrativa não representam todas as mudanças |
| video-source-probe.service.ts | estados/claims do probe | transações com projeção, sem evento canônico completo |
| video-immutable-input-preflight.service.ts | claims/resultado do input | transações com projeção, sem evento canônico completo |
| admin-video-triage-backfill.firestore.ts | manutenção da projeção | fence por versão/snapshot, não é um inventário completo |
| emulator-video-processing.service.ts | processamento de teste | writer local explicitamente existente |
| account_lifecycle/account-owned-media-deletion.firestore.ts | cancelamento e exclusão da conta | **`jobSnapshot.ref.set`, `hideBatch.set`, `jobSnapshot.ref.delete`** sem journal de mutações e sem `withAdminTriageProjection` nesse trecho |

Os nomes acima identificam superfícies verificadas no código-fonte, não
atestam exaustividade dos escritores operacionais e de projetos externos.
A exclusão de conta é especialmente importante: a confirmação posterior
do estado final não consegue recuperar um documento já eliminado se ele
nunca entrou no inventário e não existir tombstone ou sequência de eventos
verificável.

## Proteção adicionada na c18o

O teste de contrato em
`admin-video-processing-recovery.contract.test.ts` enumera os arquivos
TypeScript produtivos de `functions/src` que referenciam explicitamente
`VIDEO_PROCESSING_JOBS_COLLECTION` ou o nome literal da coleção. Uma
nova referência sem classificação passa a reprovar a CI até ser revista.

Outro contrato verifica os marcadores de escrita dos principais executores,
inclusive deletes e o caminho direto de exclusão de conta. Preserva
explicitamente a separação entre journal de auditoria, projeção e change feed,
bem como o bloqueio de ativação global.

**Limitação do contrato:** inspeção estática por nomes/trechos não detecta
automaticamente aliases, paths construídos dinamicamente, clientes externos,
migrações manuais, mudanças efetuadas fora deste repositório ou a
completude real de uma sequência de transações. Portanto não pode certificar
`GLOBAL_CONSISTENT`, mesmo que sua CI esteja verde.

## Decisão arquitetural

Uma fonte que permita a c18n fornecer evidência operacional precisa garantir,
sem hipótese implícita:

1. Identidade canônica por job, versão, geração e tipo de mutação.
2. Captura atômica **no mesmo commit** da criação, atualização,
   exclusão, mudança de faixa e manutenção das projeções.
3. Sequenciamento/referências que permitam reconciliar lacunas, replays e
   simultaneidade, sem depender da ordem de entrega de triggers.
4. Tratamento explícito de exclusões com tombstones verificáveis.
5. Cobertura demonstrável de todos os escritores, incluindo exclusão de
   conta, administração, emuladores e possíveis writers externos.
6. Limites de retenção, consulta, armazenamento, cardinalidade e custo,
   além de autorização independente para qualquer verificação operacional.

Um outbox transacional versionado é uma alternativa a ser avaliada.
Outra seria uma prova de snapshot com semântica de leitura consistente
efetivamente suportada e validada pelo Firestore. Nenhuma delas deve ser
presumida implementada nesta etapa.

## Estado de prontidão

- Fonte completa de mudanças: **NÃO COMPROVADA**.
- Reconstituição em fixture c18n: **TESTADA, não operacional**.
- Cobertura global do inventário real: **BLOQUEADA**.
- Custos operacionais reais, índices READY, vencimentos e legado:
  **pendentes de comprovação independente**.
- c19/ativação: **BLOQUEADAS**; sem deploy ou flags.

A próxima intervenção só deve implementar uma solução de captura após
decisão explícita sobre a semântica de snapshot/outbox e o alcance dos
escritores. Não usar a CI verde para promover evidências de fixture.
