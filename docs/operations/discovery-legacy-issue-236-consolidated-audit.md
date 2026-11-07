# Issue #236 — auditoria consolidada de preservacao de preferencias legadas

## Estado da entrega tecnica

Esta entrega une o fluxo TRANSACIONAL ORIGINAL B2.9.3c a leitura de documentos
originalmente gravados nesse mesmo ensaio e a politica pura B2.9.3d.
Nao e uma recuperacao de preferencia, nao cria writer nem deploy. A operacao
real continua BLOQUEADA e requer autorizacao separada.

## Objetivo

Demonstrar, em Auth + Firestore Emulators descartaveis, que a aprovacao de
revisao e a evidencia anonima de auditoria podem ser gravadas atomicamente,
que a leitura posterior identifica divergencias e que a conciliacao nao
altera nenhum documento. Preservar a privacidade em toda a validacao.

## Escopo efetivamente coberto

- A rotina B2.9.3c existente permanece a unica produtora das transacoes
  sinteticas. O novo modo explicito `--integrated-reconciliation` usa a mesma
  funcao `exercise` e os mesmos documentos resultantes de `tx.update` +
  `tx.create`, no mesmo emulador vazio.
- Le as colecoes sinteticas `legacy_discovery_recovery_approvals` e
  `synthetic_legacy_review_audit_b293c` com Firebase Admin APENAS depois
  de verificar a configuracao de emulador, credenciais e projeto demo.
- Projeta dados para a politica B2.9.3d, sem incluir UIDs nem IDs em
  relatorios. Valida 13 documentos de aprovacao e 4 de auditoria, dos
  quais 2 pares apenas possuem forma internamente coerente.
- Conta a aprovacao extra-campo como MALFORMADA, adulteracao de digest,
  evidencia preexistente de aprovacao nao consumida e estados negativos.
- Compara snapshots lidos antes e depois da reconciliacao e verifica as
  colecoes existentes. Nao executa reparo, expurgo nem exclusao.
- Contratos puros cobrem ausencia de evidencia, auditoria orfa, adulteracao,
  revisao antiga, ambiguidades e troca cruzada de evidencias.
- O relatorio final exibe SOMENTE contagens e booleanos de seguranca.
- Testes GitHub Actions: Windows e Ubuntu, baseados nos mesmos emuladores
  disposable, alem dos demais gates existentes.

## Limites de confianca importantes

1. A associacao por convencao de nomes dos documentos e SOMENTE uma
   convencao de fixture. A evidencia anonima B2.9.3c nao possui um vinculo
   criptografico verificavel com a aprovacao. Uma troca entre registros
   de mesmo horario pode parecer estruturalmente coerente. O sistema
   **NAO** pode aceitar isso como prova de origem ou autoridade real.
2. SHA-256 encadeado sem ancora externa independente nao prova integridade
   contra reescrita integral, autenticidade, durabilidade nem completude.
3. Nao sao inspecionados dados reais, snapshots importados, `users` reais,
   registros privados nem a base de producao. Os testes nao demonstram
   recuperacao efetiva de dados legados nem restauracao de metadados.
4. Os 30 dias sao uma PROPOSTA para revisao de retencao, nao uma autorizacao
   de exclusao, politica legal aprovada ou TTL implantado.
5. A aprovacao de revisao nao habilita operacao persistente ou publicacao.

## Pendencias para uma futura decisao operacional

- Provar a origem de um checkpoint recuperavel com restauracao isolada e
  integridade verificavel, sem expor dados privados em relatorios.
- Definir um vinculo autenticado entre operacao e evento de auditoria,
  registrado atomicamente, com gestao de chaves/ancora independente e
  tratamento explicito de rotacao, indisponibilidade e revogacao.
- Aprovar governanca formal de privilegios, revisores independentes,
  consentimento de titular quando cabivel, retencao e legal hold.
- Definir e testar plano de migracao com rollback, idempotencia e
  verificacao posterior; nao apagar a origem antes de comprovar a copia.
- Testar bloqueio bilateral, regras, visibilidade e ausencia de exposicao
  publica em todos os caminhos de leitura, inclusive deep links.
- Revalidar o inventario de campos legados identificado no emulador local:
  a documentacao registra dois perfis com campos privados dentre cinco
  examinados em 04/11/2026; isso NAO comprova exposicao em producao.
- Realizar revisao independente do desenho e autorizacao expressa antes
  de qualquer implantacao ou escrita no Firestore real.

## Decisao

`decision = BLOCKED`
`persistentWritesAllowed = false`
`automatedRepairAllowed = false`
`privateRecoveryRead = false`
`privateRecoveryWritten = false`
`publicVisibilityAllowed = false`

O pacote encerra a prova tecnica integrada SINTETICA, NAO a recuperacao
operacional de preferencias privadas. Falhas em testes/CI mantem o gate
fechado e nao autorizam rollback de seguranca para "fazer passar".
