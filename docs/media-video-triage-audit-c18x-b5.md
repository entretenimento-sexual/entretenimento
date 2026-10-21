# 1C2-A3b2b2c18x-B5 — Auditoria final e encerramento do escopo experimental

Data: 2026-10-21. Repositório: `entretenimento-sexual/entretenimento`.
Base auditada: `main` @ `079b1e719c858c40b4160b324507890a230aa4f3`.

## Decisão

**ENCERRAR a c18x como fase de correção e validação funcional limitada ao código e ao Firestore Emulator.**
**NÃO declarar o subsistema de priorização global pronto para produção.**
As evidências disponíveis não sustentam ativação de ordenação global, c19, deploy,
backfill produtivo, consumo global do outbox, TTL/expurgo ou liberação de flags.

Esta B5 é uma auditoria de fechamento documental: não modifica executores,
contratos, Firestore, índices, schedulers, Transcoder, comportamento de UI ou
o modelo de maioridade. CI verde é necessária para integrar o registro, mas
não substitui os requisitos de prontidão operacional.

## Evidências verificadas

| Marco | Resultado comprovável | Limite |
| --- | --- | --- |
| c18x-A | Conflitos de reserva, exclusão, sucesso atrasado, versões substituídas e rollback no Emulator | Casos adversariais delimitados |
| c18x-B1 | Retry administrativo compete com exclusão do vídeo; guard RETIRED e fila de deleção impedem reativação obsoleta | Não prova writers externos |
| c18x-B2 | Version fencing em cancelamentos/rechecks administrativos, com testes de concorrência e operação idempotente | Sem ordem global |
| c18x-B3 | Fencing de lifecycle da conta dentro dos commits terminal/admin; `deleted_accounts_audit` impede sucesso tardio após purge | Preservação de tombstone e outros caminhos legados ainda dependem de auditoria de domínio |
| c18x-B4 | Reconciliação **read-only** de época fechada no Emulator com testemunha de commits separada dos eventos: detecta eventos faltantes/extra, duplicidade, payload divergente e estado final incompatível | Harness atesta fechamento da fixture, não completude de produção; no máximo 16 jobs e 64 eventos por recorte |

A c18w detectava 43 sites estáticos (29 estágios de mutação,
1 criação e 13 operacionais/projeções). A B3 adicionou um site
terminal de transição e seu stage: inventário atual **44 sites,
30 estágios de mutação, 1 de criação e 13 sem evento**, conferido no
contrato `admin-video-triage-writer-coverage.contract.test.ts`.
São sites no fonte, não transações observadas ou cobertura externa.

O registro do outbox `media_video_processing_mutation_events` mantém:
`scope=PARTIAL_WRITER_COVERAGE`, `globalCoverageVerified=false` e
`globallySequenced=false`. O reconciliador B4 sempre retorna
`globalCoverageVerified=false`, `globallySequenced=false`,
`productionCostVerified=false`, `cleanupAuthorized=false`.

## CI da base B4: evidência independente consultada no GitHub Actions

Commit `079b1e7`: quatro checks **completed/success**:
- Canonical quality gate: [run 39586806228](https://github.com/entretenimento-sexual/entretenimento/actions/runs/39586806228).
- Isolated video reconciliation transactions: [job 119177627056](https://github.com/entretenimento-sexual/entretenimento/actions/runs/39586806075/job/119177627056).
- Video publication and moderation E2E: [job 119177627518](https://github.com/entretenimento-sexual/entretenimento/actions/runs/39586806099/job/119177627518).
- Photo publication and moderation E2E: [job 119177627741](https://github.com/entretenimento-sexual/entretenimento/actions/runs/39586806099/job/119177627741).

Resultado de CI **da B5**, após este arquivo entrar em `main`, deve
ser consultado no commit da B5; não reutilizar o selo da B4 para outro SHA.

## Registro dos riscos residuais — aceitos apenas para encerrar c18x

| Risco | Estado | Consequência / gate exigido fora desta fase |
| --- | --- | --- |
| Escritores externos, aliases, migrações, callbacks e histórico anterior ao outbox | **NÃO COMPROVADO** | Exigir censo operacional completo e testemunha independente antes de afirmar cobertura global |
| Manifesto B4 construído pelo harness, fechamento autoatestado e ordenação por job | **EMULATOR-ONLY** | Não inferir sequenciamento total, ausência de eventos históricos perdidos ou snapshot consistente de produção |
| Polling, lease, metadata e backfill sem evento por alteração de mesmo estado | **INTENCIONAL/PARCIAL** | Não usar outbox seletivo como change feed de todas as escritas |
| Conta ausente e tombstone legado ausente | **RISCO LEGADO** | Preservar `deleted_accounts_audit`, auditar purges/migrações e não tratar ausência como prova de segurança |
| Índices reais `READY`, backfill de legados, projeções vencidas, sete lanes e movimentos entre páginas | **NÃO COMPROVADO EM PRODUÇÃO** | Provar nove critérios do gate global com metadados reais, auditoria consistente e revisão independente |
| Custo real de Firestore/Transcoder, taxa de eventos, armazenamento e retenção legal | **NÃO MEDIDO/APROVADO** | Orçamento e medição reais; decisão de privacidade/retenção antes de criar consumidor, TTL ou expurgo |
| Operação produtiva, carga, falhas externas e segurança end-to-end de todos os serviços | **NÃO VALIDADO POR ESTA CI** | Ensaios e autorização específicos de staging/produção; nenhuma promoção inferida |

Riscos acima **não** foram solucionados pela B5. Aceitá-los para o
encerramento experimental não significa aceitar risco de produção.

## Invariantes e decisão para etapas posteriores

- `evaluateVideoTriageReadiness` mantém
  `globalOrderingEnabled=false`, `activationAuthorized=false`, mesmo
  com entradas favoráveis; relatório do operador não é prova autenticada.
- UI e consultas administrativas permanecem no modo de
  priorização **dentro da página** (`WITHIN_PAGE`), sem garantia global.
- Domínio de account lifecycle continua a autoridade de exclusão e da
  elegibilidade da conta; não criar política paralela de maioridade em Media.
- Preservar version fencing, cancelamento, imutabilidade do original,
  isolamento dos derivados, moderação, provas transacionais e outbox parcial.
- Sem branch, PR, deploy, flags, índices ativados, migração, consumidores,
  consulta adicional ao Transcoder, rotina destrutiva ou expurgo.

**Critério de reabertura da c18x:** defeito reprodutível e localizado nos
contratos/garantias desta fase, acompanhado de cenário adversarial e
correção mínima. Melhorias genéricas ou ausência de prova de produção
devem ser tratadas em decisão futura e separada, não em microintervenções
sem fim.

**Veredito:** c18x **ENCERRADA NO ESCOPO EXPERIMENTAL**; prontidão global
**BLOQUEADA**; c19 **BLOQUEADA**. Ações de produção requerem autorização
autônoma fundada em evidências operacionais.
