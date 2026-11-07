# Issue #236 — B2.9.3g: ensaio transacional de saneamento direcionado (SOMENTE SINTÉTICO)

## Objetivo e perímetro

Verificar um ciclo **copiar → conferir → remover campos específicos → conferir →
repetir sem mutação → restaurar → excluir apenas a cópia criada** no Firestore
Emulator descartável. O exercício usa `firebase.legacy-governance-e2e.json`,
projeto `demo-entretenimento-legacy-governance`, portas fixas locais
`127.0.0.1:28080` e `127.0.0.1:29099`. Recusa credenciais remotas,
ambiente herdado de emulador, portas ocupadas e bancos já povoados. Nenhum
arquivo `.emulator-data`, backup, exportação ou conta real é lido.

O modelo de preservação vem da implementação B2.1 existente:
`candidateFromPublicProfile()` e `assessExistingRecovery()`. Apenas os campos
`interestedInGenders` e `interestedInOrientations` podem ser removidos NESTE
ensaio porque são o inventário recuperável aprovado da B2.1. Os demais campos
privados dentre os 21 da fronteira canônica causam bloqueio; nunca são
apagados por dedução. Mesmo uma cópia compatível por estrutura não prova
proveniência ou integridade de uma operação real.

## Roteiro executado automaticamente

- Emulador inicialmente vazio, três contas fictícias: duas com preferências
  artificiais e um perfil-controle limpo. Nenhuma pessoa ou informação real.
- Cópia da representação legada para coleção de quarentena `legacy_discovery_preference_recovery`
  em transação com leitura atual da origem e do proprietário. A segunda
  tentativa não cria outro documento.
- Rejeição de tentativa com digest da cópia adulterado; origem permanece intacta.
- Rejeição quando qualquer outro campo da origem mudou desde a leitura de base.
- Rejeição quando a conta entrou em exclusão.
- Saneamento dos dois campos explicitamente permitidos, usando `FieldValue.delete()`
  dentro de transação que revalida origem, titular e quarentena; sem sobrescrever
  o restante do documento.
- Segunda tentativa de saneamento sem nova gravação; confirmação da cópia
  privada e do controle público inalterados.
- Rollback de ambos os campos e exclusão SOMENTE dos registros de quarentena
  criados na simulação, na mesma transação do emulador. Comparação de conteúdo
  lógico completo (sem reivindicar fidelidade dos timestamps internos de
  importação, que não são exercitados aqui).
- Relatório agregado sem UID, valores, hashes individuais, caminhos de usuário,
  tokens ou conteúdo privado.

## Barreiras e limitações

Este pacote **não** modifica os três caminhos de produção protegidos pela
entrega P0 anterior, não cria callable, endpoint, evento agendado ou writer
persistente, não altera Rules e não executa deploy. Todos os documentos são
fictícios. O teste unitário da callable `get-public-profiles-page` e os testes
Firestore Rules existentes devem continuar verdes; a disponibilidade de
perfis saneados para terceiros NÃO é autorizada nem medida em uma sessão real.

A preservação em checkpoint local foi examinada em B2.1, mas esta fase não
acopla aquele checkpoint a um backend de autorização, nem comprova controle
criptográfico externo, revisão independente, consentimento, retenção ou
capacidade de rollback em produção. Não reutilizar a função ou o comando de
ensaio como saneador real. O runtime P0 continua a reter perfis contaminados;
as Rules e a callable negam acesso a terceiros.

**Decisão:** `REAL_SANITIZATION_BLOCKED`, `PERSISTENT_RECOVERY_BLOCKED`,
`SOURCE_DELETION_NOT_AUTHORIZED`. Antes de qualquer execução contra dados reais
serão obrigatórias uma origem autenticável do checkpoint, auditoria de autoridade,
revisão de privilégios/consentimento, plano de rollback independente e autorização
separada. A Issue #235 continua bloqueada até validação das superfícies públicas.

## Execução local

Após `npm run rules:build` e `npm --prefix functions run build`:

```powershell
node --test scripts/tests/discovery-legacy-sanitization-synthetic.policy.test.mjs scripts/tests/discovery-legacy-sanitization-synthetic.contract.test.mjs
node scripts/maintenance/rehearse-discovery-legacy-sanitization-synthetic.mjs --preflight
$env:GCLOUD_PROJECT = 'demo-entretenimento-legacy-governance'
$env:FUNCTIONS_EMULATOR = 'true'
node node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --project demo-entretenimento-legacy-governance --only auth,firestore --config firebase.legacy-governance-e2e.json "node scripts/maintenance/rehearse-discovery-legacy-sanitization-synthetic.mjs --exercise"
```

Os dois últimos valores de ambiente são removidos/restaurados pelo instalador
na conclusão. Executar o bloco manual somente em ambiente de desenvolvimento
sem credenciais remotas. O `--exercise` requer emuladores demo já inicializados;
o `--preflight` requer portas livres. Não rodar o ensaio com snapshot importado.
