# Discovery: auditoria e contrato de recuperação de interesses legados (Issue #236)

## Situação constatada — 04/11/2026

Na instância local do Firestore Emulator (`entretenimento-sexual`), foram examinados 5 documentos de `public_profiles`. Dois contêm os campos vedados `interestedInGenders` e `interestedInOrientations`: as quantidades de itens são, respectivamente, 3/0 e 2/3. A verificação não expôs valores nem identificadores.

Nos dois casos, os documentos `users/{uid}` existem, mas não contêm esses campos exatos; `users/{uid}/preferences/profile`, `users/{uid}/preferences/intent`, `public_user_preferences/{uid}` e `match_profiles/{uid}` não foram encontrados. A ausência dessas fontes **não prova** que nunca houve dados privados ou que não existam outros backups. É possível que os valores em `public_profiles` sejam a única cópia acessível no emulador atual.

O snapshot atual foi exportado com `npm run emu:save`, com metadados em `.emulator-data/firebase-export-metadata.json` e backup anterior em `.emulator-data-backups`. A restauração completa ainda não foi testada. Os diretórios devem permanecer fora do controle de versão e protegidos contra acesso indevido.

## Fase A — inventário SOMENTE-LEITURA (implementada)

Programa: `scripts/maintenance/audit-discovery-legacy-preferences-readonly.mjs`.

Pré-condições obrigatórias:
- Firestore Emulator ativo em `127.0.0.1:8080`, confirmado por `http://127.0.0.1:4400/emulators`;
- `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`;
- `FIREBASE_PROJECT_ID`, `GCLOUD_PROJECT` e `GCP_PROJECT`, se definidos, devem apontar para `entretenimento-sexual`;
- presença de `.emulator-data/firebase-export-metadata.json` não vazio; **isso não equivale a um teste de restauração**;
- no máximo 200 documentos `public_profiles`: em bases maiores, a rotina falha sem emitir laudo parcial, exigindo uma implementação paginada e revisada.

Exemplo PowerShell, na raiz do repositório:

```powershell
$anterior = $env:FIRESTORE_EMULATOR_HOST
try {
    $env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
    node scripts/maintenance/audit-discovery-legacy-preferences-readonly.mjs --dry-run
    if ($LASTEXITCODE -ne 0) { throw 'Auditoria local nao concluida.' }
} finally {
    $env:FIRESTORE_EMULATOR_HOST = $anterior
}
```

A rotina consulta os campos proibidos na coleção pública e a **presença** de documentos nos cinco caminhos acima. Não coleta identificadores, não emite valores privados, não gera CSV/JSON com informações individuais e não altera documentos. O console apresenta apenas totais agregados, nomes dos campos proibidos, tipos e contagens. A presença de uma chave com o mesmo nome em outra fonte **não prova equivalência de conteúdo**.

Teste de contrato sem emulador: `node --test scripts/tests/discovery-legacy-preferences-readonly.policy.test.mjs`.


## Fase B0 — fronteira de quarentena privada (preparação sem migração)

Esta fase reserva **apenas** o namespace `legacy_discovery_preference_recovery/{ownerUid}`, por meio do fragmento `firestore-rules/legacy_discovery_preference_recovery.rules` incluído no manifesto do build. As Firestore Rules negam `get`, `list`, `create`, `update` e `delete` a **todos os clientes**, inclusive ao proprietário e a sessões com claims administrativas; documentos descendentes também são negados. É uma coleção **backend-only**. O Admin SDK ignora Firestore Rules: o futuro writer administrativo requer verificação separada de privilégios, revisão e auditoria. **Não há escritor, callable, endpoint, tarefa de cron, migração ou deploy nesta fase**.

### Modelo proposto para avaliação futura (não persistido)

- **Identificador:** UID do proprietário como ID do documento; proibir ID arbitrário definido pelo cliente.
- **Origem canônica:** `public_profiles/{ownerUid}` do snapshot validado; aceitar apenas campos explicitamente enumerados no inventário; a leitura deve ser local e em contexto administrativo confiável.
- **Conteúdo:** preservar os arrays originais sem converter identidade, orientação, filtros, gênero ou ordem. O registro pode armazenar o payload bruto sob `legacyRaw`, somente nessa área privada.
- **Integridade e proveniência:** registrar versão do esquema, referência de checkpoint, evidência de origem e hash de integridade **somente dentro da área privada**; não imprimir UID, hashes individualizados ou valores em logs. Dada a divergência de `createTime/updateTime` entre imports, comparar o conteúdo explicitamente, sem depender da identidade dos metadados administrativos do emulador.
- **Estado inicial:** `PENDING_REVIEW`; **não** preencher `users/{uid}/preferences/profile`, `discoveryPreferences`, `publicSeekingGenders` ou outros campos ativos. **Não** definir `showSeekingPublicly`/`showIntentPublicly`/`showPreferenceBadges` como verdadeiro por inferência.
- **Permissões futuras:** qualquer fluxo de consulta do proprietário deve usar uma Callable dedicada que confirme a identidade, estado da conta e elegibilidade, e retorne apenas os dados que o titular está autorizado a revisar. Nenhum cliente acessa o registro bruto por SDK diretamente.
- **Trânsito para revisão:** exigir plano separado de retenção, consentimento explícito por campo, versionamento e provas de compatibilidade do modelo. Não inferir que `interestedInOrientations` possui correspondência 1:1 no modelo moderno.
- **Escrita futura e rollback:** antes de qualquer gravação, validar restauração em instância isolada, regras compiladas, baseline de hashes e dry-run detalhado mas sem PII, idempotência no mesmo `ownerUid`, e verificação posterior sem apagar a origem. A exclusão pública só poderá ocorrer depois de confirmar a cópia privada e o processo de revisão. O backfill administrativo não deve ser utilizado como mecanismo de recuperação.
- **Regras em produção:** a presença de regras em PR ou na `main` **não confirma deploy**. Mesmo após aprovar o PR, não executar operações na base remota até autorização e rollout separado, com testes.

### Segurança obrigatória para o namespace de quarentena

A suíte `firestore-rules/tests/legacy-discovery-preference-recovery.rules.spec.ts` semeia dados **sintéticos** ignorando regras e exige recusa de leitura, listagem, gravação, alteração e exclusão por visitante, titular, moderador, administrador com claims e sessão anônima, inclusive em documentos descendentes. Testa também ausência de exposição por collection group query. A suíte é executada pelo gate canônico `npm run test:rules`; cada PR deve passar no Quality Gate.

**Aprovar a fronteira de segurança não equivale a autorizar escrever um único documento de recuperação.** A Fase B1 deve preparar uma rotina separada, testada primeiramente contra uma importação isolada e com plano de rollback.

## Fase B1 — ensaio sem escrita em snapshot isolado (implementação sob revisão)

Arquivos:
- `scripts/maintenance/discovery-legacy-recovery-rehearsal.policy.mjs`: contrato puro de preservação, integridade do conteúdo e avaliação de conflitos;
- `scripts/maintenance/rehearse-discovery-legacy-recovery-readonly.mjs`: cria um processo de Firestore Emulator isolado a partir do export local; lê o conteúdo e **não** grava nenhuma coleção;
- `scripts/tests/discovery-legacy-recovery-rehearsal.policy.test.mjs`: testes de integridade, ordenação, duplicatas, ausência versus array vazio, idempotência, limites de acesso/volume e recusa de operação perigosa;
- `.github/workflows/discovery-legacy-recovery-rehearsal-guard.yml`: testes de contrato em Windows e Linux, sem dados reais nem credenciais.

### Como funciona (somente após integrar o código e sincronizar a main)

O script exige `--dry-run`, projeto `entretenimento-sexual`, snapshot local não vazio em `.emulator-data`, JAR do Firestore Emulator e Java 21. **Pré-condição:** executar `npm run rules:build` após sincronizar a `main`, pois `firestore.rules` é gerado localmente e precisa conter o fragmento de quarentena incorporado no PR #239. O ensaio recusa o arquivo gerado desatualizado e não o atualiza automaticamente. Ele **não usa** o emulador principal `127.0.0.1:8080`: verifica que as portas `28080` e `29150` estão livres e inicializa **um processo filho** em `127.0.0.1:28080` com `--seed_from_export`, encerrando-o ao fim da leitura. A origem não é sobrescrita. Se as portas estiverem ocupadas, a operação é recusada sem encerrar processos alheios.

Na raiz do projeto, após verificar `git status -sb` e a sincronização:

```powershell
$original = $env:FIRESTORE_EMULATOR_HOST
try {
    Remove-Item Env:\FIRESTORE_EMULATOR_HOST -ErrorAction SilentlyContinue
    npm run rules:build
    if ($LASTEXITCODE -ne 0) { throw 'Geracao das Rules nao concluida.' }
    node scripts/maintenance/rehearse-discovery-legacy-recovery-readonly.mjs --dry-run
    if ($LASTEXITCODE -ne 0) { throw 'Ensaio B1 nao concluido.' }
} finally {
    if ($null -eq $original) {
        Remove-Item Env:\FIRESTORE_EMULATOR_HOST -ErrorAction SilentlyContinue
    } else {
        $env:FIRESTORE_EMULATOR_HOST = $original
    }
}
```

Se a variável `GOOGLE_APPLICATION_CREDENTIALS` estiver definida ou os IDs de projeto apontarem para ambiente diferente, a rotina falha antes de inicializar o Firebase. Nenhuma credencial de produção é necessária.

### Saída e limites do ensaio

- Lê no máximo **200** documentos raiz de `public_profiles`; acima disso, falha sem publicar inventário incompleto.
- Examina **somente** `interestedInGenders` e `interestedInOrientations`, e **interrompe** caso encontre outros campos privados proibidos ou formatos incompatíveis no mesmo perfil.
- Preserva **em memória** a sequência, a capitalização, os espaços, as duplicatas e a diferença entre campo ausente e lista vazia. Não interpreta semântica, não transforma em `hardRules`, não altera identidade nem ativa filtros/visibilidade.
- Confere existência do documento `users/{ownerUid}`, avalia colisões com `legacy_discovery_preference_recovery/{ownerUid}` e compara hash SHA-256 de conteúdo, incluindo presença/ausência de campos. **Hashes e IDs nunca são impressos**.
- Se houver registro privado pré-existente, o ensaio identifica `ALREADY_PRESERVED` somente quando metadados e conteúdo coincidem; qualquer conflito interrompe a operação sem sobreposição.
- O relatório apresenta apenas `candidates`, `wouldCreate`, `alreadyPreserved`, contagens agregadas dos itens, total de documentos examinados e **zero** escritas. O candidato `PENDING_REVIEW` nunca é salvo por esta rotina.
- Não se afirma restauração de metadados: duas importações do snapshot exibiram os mesmos 563 documentos/valores, mas diferenças de `createTime/updateTime` nos 563. O digest do conteúdo não depende desses timestamps administrativos.
- Testes puros com valores **sintéticos** simulam preservação e idempotência; ainda **não** demonstram rollback de uma transação real, que exige um writer testável e ensaios isolados específicos.
- O snapshot deve permanecer fora do Git, em armazenamento local protegido. O runner não imprime logs Java, valores sensíveis, UID ou hashes individualizados.

### Critérios bloqueadores para a Fase B2

Mesmo com B1 aprovado, **não executar gravação** enquanto não houver: confirmação do checkpoint a ser usado; contrato de autorização backend e menor privilégio; prova de rollback/idempotência com transação em ambiente isolado; tratamento de conflitos; verificação de integridade após cópia; documentação da retenção; e testes de Rules/visibilidade/bloqueio bilateral. O uso de Admin SDK ignora Firestore Rules. Qualquer futura rotina de retenção persistente exigirá **etapa separada e autorização explícita**, sem criação automática de branch, PR, merge ou deploy.

## Fase B2 — contrato transacional de reversão no emulador isolado

Módulo: `scripts/maintenance/discovery-legacy-recovery-transaction.policy.mjs`.

**Escopo deste commit:** criar e testar um motor de transações **sem executá-lo contra o snapshot do operador**. Não há CLI novo, API, callable, deploy, job agendado nem escritor de produção. O contrato apenas pode ser invocado por uma etapa futura de ensaio que construa uma instância de Firestore Emulator isolada. O módulo não inicializa Firebase e não inicia emuladores por conta própria.

Fronteiras mandatórias antes de qualquer transação:

- `FIRESTORE_EMULATOR_HOST` precisa ser exatamente `127.0.0.1:28080`, sem esquema ou alias; rejeita 8080 e qualquer destino remoto.
- `GOOGLE_APPLICATION_CREDENTIALS` deve estar ausente. IDs de projeto definidos no ambiente precisam corresponder a `entretenimento-sexual`.
- No máximo **10 candidatos por transação**, gerados pelo contrato B1; cada um deve ser único, com hash válido, campos estritamente permitidos, `lifecycle: PENDING_REVIEW` e `visibilityConsentConfirmed: false`.
- Dentro de uma transação Firestore, conferir existência de `public_profiles/{ownerUid}` e `users/{ownerUid}`, revalidando os valores legados e o hash da origem **antes de qualquer escrita**. Uma mudança de origem ou conflito no registro privado aborta o lote inteiro.
- Gravar apenas `legacy_discovery_preference_recovery/{ownerUid}` com `transaction.create()`; para cópias idênticas pré-existentes, não sobrescrever e tratar como idempotência. Não gravar em `users`, `public_profiles` nem preferências ativas.
- A reversão é transacional e restrita aos IDs retornados pela **mesma execução de cópia**. Antes de excluir, revalidar conteúdo, proveniência, estado e hash; em caso de divergência, **não excluir** e sinalizar conflito. Registros pré-existentes jamais entram no conjunto de exclusão.
- `exerciseIsolatedRecoveryRollback()` encadeia cópia, verificação dos registros privados, rollback em `finally` e inspeção pós-rollback das origens e dos registros recuperados. Somente após todas essas etapas retorna um relatório agregado com `created`, `alreadyPreserved`, `rolledBack` e zero modificações declaradas em perfis/visibilidade.
- Logs, relatórios e documentação não podem conter UIDs, valores sensíveis nem hashes individualizados. Os identificadores retornados internamente pelo contrato de escrita **não devem ser serializados** pelo futuro runner.

Teste de contrato com memória sintética, **sem Firestore ou snapshot real**:

```powershell
node --test scripts/tests/discovery-legacy-recovery-transaction.policy.test.mjs
```

A suíte simula transações com aplicação atômica e cobre sucesso, idempotência, conflito, mudança da fonte, exclusão indevida, rollback condicionado e restauração do estado original. O workflow `Discovery Legacy Recovery Transaction Guard` roda esses testes em Windows e Ubuntu após push na `main`.

**Limites do que foi demonstrado:** o teste em memória **não prova** que uma transação real no Firebase Emulator aceita esse fluxo, nem a recuperação de metadados `createTime/updateTime`, nem rollback diante de interrupção abrupta do processo. O próximo gate exige um *runner dedicado*, que invoque o motor **somente** em uma importação isolada e efêmera do snapshot, compare estado antes/depois e encerre o emulador filho mesmo em caso de falha. Nenhuma recuperação deve ser gravada no emulador principal ou remoto durante essa fase. A sanitização de `public_profiles` e o eventual consentimento dos proprietários continuam bloqueados.

## Fase B2.1 — ensaio transacional real em importação isolada

Executor: `scripts/maintenance/rehearse-discovery-legacy-recovery-rollback.mjs`.
Política de preflight, comparação de snapshots e saída: `scripts/maintenance/discovery-legacy-recovery-rollback-runner.policy.mjs`.
Testes sintéticos adicionais: `scripts/tests/discovery-legacy-recovery-rollback-runner.policy.test.mjs`.

**Importante:** a B2.1 **escreve temporariamente** dois documentos de quarentena no processo de **Firestore Emulator efêmero** que ela mesma inicia na porta `127.0.0.1:28080`, valida a cópia e a idempotência, **reverte esses documentos**, confere o conteúdo dos documentos originais e encerra o processo. Ela **não executa nenhuma escrita** nos emuladores principais (8080), nos arquivos `.emulator-data`, em Firestore remoto ou nas preferências ativas. Não possui função de persistir ou implantar dados.

### Pré-condições e execução local (somente após sincronizar a main)

- A árvore de trabalho deve estar limpa e `main` sincronizada; antes da execução, reconstruir localmente `firestore.rules` via `npm run rules:build` **sem deploy**.
- `.emulator-data` precisa conter um export Firestore legítimo, com arquivos de metadados não vazios; preservar esse checkpoint e os backups. A execução exige Java e o JAR do Firestore Emulator local já empregado na comparação de snapshots.
- As portas `28080` e `29150` precisam estar livres. O runner não mata processos preexistentes nessas portas.
- Não definir `GOOGLE_APPLICATION_CREDENTIALS` nem outro project ID; o runner só aceita projeto `entretenimento-sexual`. Se `FIRESTORE_EMULATOR_HOST` apontar para a porta principal 8080, o runner recusa a execução; remova temporariamente essa variável apenas no terminal do comando.
- A operação requer a flag exata `--isolated-rollback-test`. Não há modo `--apply`, `--write`, `--deploy` ou de retenção persistente.

```powershell
cd C:\entretenimento
git status -sb
git rev-list --left-right --count HEAD...origin/main

npm run rules:build
if ($LASTEXITCODE -ne 0) { throw 'Falha ao gerar Rules locais.' }

$anterior = $env:FIRESTORE_EMULATOR_HOST
try {
    Remove-Item Env:\FIRESTORE_EMULATOR_HOST -ErrorAction SilentlyContinue
    node scripts/maintenance/rehearse-discovery-legacy-recovery-rollback.mjs --isolated-rollback-test
    if ($LASTEXITCODE -ne 0) { throw 'Ensaio B2.1 isolado nao aprovado.' }
} finally {
    if ($null -eq $anterior) {
        Remove-Item Env:\FIRESTORE_EMULATOR_HOST -ErrorAction SilentlyContinue
    } else {
        $env:FIRESTORE_EMULATOR_HOST = $anterior
    }
}
```

### Provas exigidas e limites

1. **Verificação prévia:** identificar exatamente **2 candidatos**, **5 entradas de gênero** e **3 entradas de orientação** na importação; recusar snapshots divergentes, formatos incompatíveis ou ausência dos documentos `users/{uid}`.
2. **Baseline integral de conteúdo:** percorrer recursivamente coleções e subcoleções no processo temporário (limites defensivos de 2.500 documentos e 600 coleções), mantendo somente hashes em memória, sem publicar IDs/valores.
3. **Cópia:** transação real `create` exclusivamente em `legacy_discovery_preference_recovery/{ownerUid}`, recusando sobreposição ou conflitos.
4. **Idempotência e integridade:** leitura independente dos registros copiados e segunda transação, que deve criar **zero** documentos.
5. **Rollback obrigatório:** transação `delete` somente sobre os registros criados na primeira tentativa; registros anteriores não podem ser apagados.
6. **Comparação integral:** recolher novo baseline e exigir mesmos documentos, coleções e hashes de campos; comparar também os bytes dos arquivos originais do export Firestore antes e depois. O relatório contém somente totais agregados, nunca os valores sensíveis, UIDs ou hashes.
7. **Encerramento:** terminar o processo filho mesmo sob erro, sem exportá-lo de volta. Qualquer erro bloqueia o sucesso e exige investigação; não tentar saneamento público automaticamente.

A B2.1 **não comprova** fidelidade de `createTime/updateTime` entre importações (já foram observadas divergências), persistência em produção, comportamento sob falha abrupta durante o commit, autorização de um futuro backend administrativo ou consentimento dos titulares. Uma aprovação desse ensaio é **apenas um gate técnico** para planejar a preservação privada. A exclusão dos campos legados de `public_profiles`, o uso de backfill administrativo e qualquer deploy permanecem proibidos.

## Fase B2.2 — governança da retenção privada (preparação sem escritor)

Módulo: `scripts/maintenance/discovery-legacy-recovery-persistence.policy.mjs`. Testes puros: `scripts/tests/discovery-legacy-recovery-persistence.policy.test.mjs`.

A B2.1 confirmou **somente no Firestore Emulator isolado** a criação, leitura, idempotência e reversão: 2 registros temporários criados, 0 na segunda tentativa, 2 revertidos, 563 documentos comparados com 0 divergências de conteúdo. Isso não é autorização para copiar dados persistentemente.

**Implementação desta etapa:**

- Constrói, **apenas em memória**, dois *intents* privados de futura retenção, vinculados ao UID e ao digest da origem; não duplica os arrays privados no plano. Exige candidatos íntegros e exatamente 2 perfis, 5 entradas de gênero e 3 de orientação.
- Exige formato coerente do relatório B2.1: importação isolada, idempotência, rollback completo, ausência de diferenças lógicas e export original preservado. O relatório é um **relato local estrutural, não uma prova assinada/autenticada**; um chamador malicioso poderia falsificar os campos. Um escritor futuro deverá refazer as verificações em servidor confiável.
- Propõe **30 dias para análise**, sem criar TTL, agendador ou política legal definitiva. O prazo é uma **proposta operacional**, sujeita à revisão de necessidade, consentimento e retenção antes de qualquer persistência. Exclusão de conta deve remover também a quarentena; o fluxo de lifecycle ainda **não foi integrado** a essa nova coleção.
- Mantém `PENDING_REVIEW`, `visibilityConsentConfirmed: false`, sem `hardRules`, sem `showSeekingPublicly`, sem migração de orientação/gênero e sem modificar `public_profiles`.
- Retorna um relatório de pré-condições com decisão `BLOCKED` e sete bloqueadores não configuráveis pelo chamador: autenticação administrativa **verificada em backend**, autorização explícita da operação, validação/implantação da integração ao expurgo de conta, mecanismo de expiração, escritor de auditoria backend-only, barreira transacional integrada ao writer e aprovação de migração/rollback persistente. O relatório de auditoria é estritamente agregado, com campos permitidos, sem UID, valores, hashes individuais ou texto livre.
- `assertPersistentRecoveryMayExecute()` **sempre rejeita** execução persistente. Não existe CLI de persistência, callable, endpoint, trigger, cron, writer, rotina de expurgo, regra de autorização ou deploy neste commit. A ausência desses componentes é proposital.

**Governança exigida para um eventual writer futuro** (não implementada aqui):

1. Verificar a identidade do operador e o papel administrativo em fonte de autoridade *server-side*, conferir conta ativa e privilégios atuais, e registrar autorização específica para cada lote. Não aceitar `admin: true` nem booleanos de aprovação enviados pelo cliente como prova.
2. Validar a origem no banco no momento da operação, cotejar o checkpoint e sua proveniência, conferir versão das Rules, hashes e conflitos; a transação deve continuar restrita à quarentena backend-only.
3. Criar trilha de auditoria mínima com garantias de integridade e acesso interno; impedir valores sensíveis, UIDs brutos e hashes individualizados em logs/telemetria.
4. Definir base jurídica, finalidade, retenção mínima necessária e caminho real de expiração/eliminação, incluindo exclusão da conta e solicitações de titular. O TTL de 30 dias é somente uma proposta.
5. Testar transação e rollback **com o emulador isolado**, incluindo falhas entre cópia, verificação e exclusão, antes de considerar qualquer execução persistente.
6. Exigir decisão independente do proprietário para interpretar/ativar preferências; preservação privada não equivale a consentimento de descoberta pública.

**Operação:** testar apenas a política com `node --test scripts/tests/discovery-legacy-recovery-persistence.policy.test.mjs`. O workflow de guarda também a executa em Windows e Ubuntu. Não executar backfill administrativo nem remover campos públicos durante a preparação.

## Fase B2.3 — quarentena vinculada ao expurgo de contas (somente código)

Arquivos:
- `functions/src/account_lifecycle/account-legacy-recovery-purge.policy.ts`: rotina testável de bloqueio por estado/lease, titularidade, exclusão recursiva e confirmação de ausência.
- `functions/src/account_lifecycle/account-data-deletion.firestore.ts`: integração **ao método existente `deletePreferences(uid)`**, sem alterar seu nome ou criar novo fluxo agendado.
- `functions/src/account_lifecycle/account-data-retention.policy.ts`: versão da matriz de retenção elevada para **13**; o domínio `preferences` continua obrigatório antes da finalização.
- Testes: `account-legacy-recovery-purge.policy.test.ts` e `account-legacy-recovery-purge.integration.contract.test.ts`.

**Comportamento quando o código for futuramente implantado:**

1. O agendador `purgeDeletedAccounts` já exige exclusão programada, respeita `legalHold`/`billingHold`, adquire lease e marca a conta `deleted`; a integração acrescentada **não cria agendador, callable, rota externa ou writer de recuperação**.
2. A limpeza de quarentena valida que `users/{uid}` ainda existe com `accountStatus === 'deleted'`, `purgeLeaseOwner` preenchido e `purgeLeaseUntil` no futuro. Verifica novamente o lease antes da exclusão.
3. Se `legacy_discovery_preference_recovery/{uid}` existir, `ownerUid` precisa coincidir; divergência impede a operação. Não lê nem registra `legacyRaw` em logs.
4. `db.recursiveDelete` remove o documento **e eventuais subcoleções**, inclusive quando o documento raiz já não existe. Após a remoção, verifica documento e subcoleções restantes. Falhas bloqueiam o resultado `preferences`, portanto impedem a finalização e provocam o mecanismo existente de retry do lifecycle.
5. Ausência da quarentena é tratada de forma idempotente, sem afetar preferências ativas ou campos de visibilidade. A contagem da limpeza do domínio inclui o documento de recuperação removido, quando presente. O método `deletePreferences` preserva seu nome e fluxo de erro existente.
6. A matriz continua associando o resultado do domínio `preferences` ao bloqueio de finalização de `users/{uid}`. O fluxo não transforma os valores legados em preferências, não remove `interestedInGenders`/`interestedInOrientations` de contas ativas e não habilita acesso a terceiros.

**Limitações relevantes:** a checagem de lease e a exclusão recursiva são operações separadas, logo **não formam uma fence transacional contra um writer concorrente**. O writer futuro deve garantir em uma transação própria que contas `deleted` ou em purge nunca recebam novos registros de recuperação. A verificação de subcoleções depende de `listCollections()`. Ainda faltam validação real no emulador, testes de corrida/aborto e deploy (não autorizado). Até isso ocorrer, permanece o bloqueador `ACCOUNT_DELETION_PURGE_NOT_DEPLOYED_OR_VERIFIED`.

**Decisão de publicação:** esta etapa é somente código e testes. Não executa `purgeDeletedAccounts`, não altera dados da instância principal ou produção, não implementa writer de retenção, TTL, autenticação administrativa ou audit writer. A política B2.2 continua com `persistentWritesAllowed: false` e `assertPersistentRecoveryMayExecute()` recusando qualquer chamada.

## Fase B2.4 — E2E de expurgo com contas sintéticas (sem checkpoint)

Executor: `scripts/maintenance/rehearse-account-legacy-recovery-purge-synthetic.mjs`.
Contrato prévio: `scripts/maintenance/account-legacy-recovery-purge-emulator.policy.mjs`.
Testes puros: `scripts/tests/account-legacy-recovery-purge-emulator.policy.test.mjs`.

**Este runner é distinto do B2.1:** não importa `.emulator-data`, não lê o checkpoint real e não chama o agendador `purgeDeletedAccounts`. Inicia **um Firestore Emulator novo e vazio** (projeto `demo-entretenimento-legacy-purge`) nas portas `127.0.0.1:28080` e `29150`, usando o JAR local e Rules compiladas. O projeto demo e a indisponibilidade obrigatória de portas preexistentes impedem usar o emulador principal `8080`. Só manipula documentos sintéticos, encerrando o processo filho sem exportá-lo.

O script carrega o **adaptador real compilado** `FirestoreAccountDataDeletionAdapter` e o método público preservado `deletePreferences(uid)`, com o ciclo normal de erro do domínio `preferences`. Não instala trigger nem callable novo, não ativa writer de recuperação, não importa nem transforma valores do incidente.

**Pré-condições**: `main` sincronizada, árvore limpa, Java disponível, JAR v1.22.0 do Firestore Emulator instalado na cache Firebase, `functions/node_modules` instalado, `functions/lib` compilado e `firestore.rules` recém-gerado. A operação recusa credenciais ADC explícitas, project IDs preconfigurados, `FIREBASE_CONFIG`, `FUNCTIONS_EMULATOR` ou `FIRESTORE_EMULATOR_HOST` predefinidos e só aceita a flag `--isolated-synthetic-purge-test`.

Comandos no PowerShell (sem deploy):

```powershell
cd C:\entretenimento
git status -sb
git rev-list --left-right --count HEAD...origin/main

npm run rules:build
if ($LASTEXITCODE -ne 0) { throw 'Rules locais invalidas.' }

npm --prefix functions run build
if ($LASTEXITCODE -ne 0) { throw 'Build das Functions falhou.' }

node --test scripts/tests/account-legacy-recovery-purge-emulator.policy.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'Preflight B2.4 falhou.' }

# Nao apague configuracoes de credenciais/projeto para contornar os guards.
# Se qualquer variavel de projeto ou credencial estiver definida, o
# executor falhara por seguranca. FIRESTORE_EMULATOR_HOST normalmente
# pode ser removida temporariamente para esta execucao.
$firestoreAnterior = $env:FIRESTORE_EMULATOR_HOST
try {
    Remove-Item Env:\FIRESTORE_EMULATOR_HOST -ErrorAction SilentlyContinue
    node scripts/maintenance/rehearse-account-legacy-recovery-purge-synthetic.mjs --isolated-synthetic-purge-test
    if ($LASTEXITCODE -ne 0) { throw 'Ensaio sintetico B2.4 nao aprovado.' }
} finally {
    if ($null -eq $firestoreAnterior) {
        Remove-Item Env:\FIRESTORE_EMULATOR_HOST -ErrorAction SilentlyContinue
    } else {
        $env:FIRESTORE_EMULATOR_HOST = $firestoreAnterior
    }
}
```

O relatório esperado (apenas dados agregados) deve confirmar:
- exclusão de 1 documento de recuperação e 2 documentos descendentes do mesmo UID;
- segunda chamada idempotente (0 alterações);
- exclusão de descendentes mesmo quando o documento pai já não existe;
- bloqueio por `ownerUid` incompatível, lease expirado e conta ativa, preservando esses registros;
- conta de terceiro sintética inteiramente preservada;
- erro de `preferences` propagado ao `executeAccountDataDeletionDomains` e `canFinalizePrivateUserDeletion` retornando falso em plano com os demais domínios simuladamente concluídos;
- nenhuma exportação/importação de checkpoint, nenhuma alteração no emulador principal ou remoto.

**Limites:** este é um ensaio isolado com contas artificiais e o adaptador de preferências real. Não executa o agendador de purge completo, não exerce contratos de billing, mídia e moderação, nem prova o comportamento de um writer concorrente; a verificação do lease e a exclusão recursiva ainda não são atômicas. Não é autorização para produção, alteração de perfis reais ou escritor persistente. A política B2.2 continua bloqueada, inclusive por `TRANSACTIONAL_OWNER_FENCE_NOT_INTEGRATED_IN_BACKEND_WRITER`.

## Fase B2.5 — fence transacional de exclusão e corrida sintética

**Objetivo:** impedir que uma rotina futura recrie `legacy_discovery_preference_recovery/{ownerUid}` enquanto `users/{uid}` migra para `pending_deletion`/`deleted`, mesmo quando a leitura inicial ocorre antes da transição.

Contratos implementados:

- `scripts/maintenance/discovery-legacy-owner-fence.policy.mjs`: política pura `RECOVERY_OWNER_FENCE_VERSION = 1`. **Regra estrita** `assertRecoveryOwnerEligibleForTransactionalStaging(owner)` exige `accountStatus: 'active'` explícito, ausência de marcadores de solicitação/lease de purge e ausência de bloqueios `interactionBlocked`, `loginAllowed: false`, `legalHold` ou `billingHold`. Exceções são genéricas, sem UID/valores. **A regra estrita é pré-condição técnica, não autorização administrativa para produção.**
- O motor B2.1 **isolado/histórico** `copyIntoIsolatedRecovery()` passa a aplicar `assertIsolatedRecoveryOwnerNotDeleting()` aos snapshots de `users`, **dentro da transação Firestore que cria a quarentena**. Essa variante preserva a compatibilidade com snapshots legados que não contêm `accountStatus`, mas recusa estados de exclusão e marcadores de purge. **Não reutilizar a variante histórica como permissão de um writer persistente.**
- `scripts/maintenance/discovery-legacy-owner-fence-race.exercise.mjs`: rotina dedicada **somente** ao projeto demo `demo-entretenimento-legacy-purge`, com `FIRESTORE_EMULATOR_HOST=127.0.0.1:28080`. Cria exclusivamente UIDs e registros artificiais e faz testes reais de `runTransaction` usando o predicado estrito.
- O executor de teste B2.4 `rehearse-account-legacy-recovery-purge-synthetic.mjs` agora incorpora dois cenários B2.5 e retorna somente cinco novos indicadores agregados. O contrato de relatório rejeita campos extras, UIDs e hashes individuais.

**Cenários de corrida:** (1) uma cópia e a mudança para `pending_deletion` são executadas concorrentemente em transações Firestore que acessam a **mesma** `users/{uid}`, sem pausas artificiais que possam criar deadlock. Ambas as ordens de serialização são legítimas: se a cópia vencer, o purge remove o registro; se o pedido de exclusão vencer, a barreira rejeita a cópia. Uma leitura anterior ao início dessas transações não é aceita como autorização; novas cópias após `pending_deletion` são rejeitadas. (2) a cópia é concluída deliberadamente **antes** de `deleted`; a rotina de purge remove o registro, e qualquer tentativa posterior de recriá-lo é recusada pelo status da conta dentro da transação.

**Limite de prova:** a revalidação do lease imediatamente antes de `recursiveDelete` continua **não atômica**, mas o contrato de qualquer writer futuro exige que as decisões sobre elegibilidade do proprietário e criação de recuperação sejam serializadas pela mesma transação Firestore. O teste verifica o conflito apenas no emulador demo; não verifica um writer persistente, implantação, processos remotos ou interações arbitrárias de serviços que desrespeitem esse contrato. A conclusão B2.5 não libera migração, backfill nem saneamento dos campos públicos.

**Execução local:** após sincronizar a `main`, rodar `npm run rules:build`, `npm --prefix functions run build`, depois `node --test scripts/tests/discovery-legacy-owner-fence.policy.test.mjs` e `node --test scripts/tests/account-legacy-recovery-purge-emulator.policy.test.mjs`. A execução real de corrida é o **mesmo CLI** sintético B2.4:

```powershell
$hostAnterior = $env:FIRESTORE_EMULATOR_HOST
try {
  Remove-Item Env:\FIRESTORE_EMULATOR_HOST -ErrorAction SilentlyContinue
  node scripts/maintenance/rehearse-account-legacy-recovery-purge-synthetic.mjs --isolated-synthetic-purge-test
  if ($LASTEXITCODE -ne 0) { throw 'Falha no ensaio B2.5 isolado.' }
} finally {
  if ($null -eq $hostAnterior) {
    Remove-Item Env:\FIRESTORE_EMULATOR_HOST -ErrorAction SilentlyContinue
  } else {
    $env:FIRESTORE_EMULATOR_HOST = $hostAnterior
  }
}
```

Além dos indicadores B2.4 já aprovados, o relatório precisa conter `staleWriteAfterDeletionRejected: true`, `writerBeforeDeletionPurged: true`, `recreationAfterPurgeRejected: true`, `conflictingTransactionDenied: true` e `raceOwners: 2`. **Não executar** com credenciais, project IDs predefinidos, host de emulador principal ou dados pessoais. O script recusa contexto inseguro.

## Fase B2.6 — preparação de autorização administrativa e auditoria mínima

**Escopo: contrato e testes, sem endpoint nem gravação.** Fonte:
`scripts/maintenance/discovery-legacy-recovery-governance.policy.mjs`.
Testes: `scripts/tests/discovery-legacy-recovery-governance.policy.test.mjs`.

O avaliador `evaluateLegacyRecoveryGovernanceEvidence(input)` analisa **somente a forma de evidências recebidas** e devolve um relatório `B2_6_EVIDENCE_ONLY`, sempre com `outcome: 'BLOCKED'` e `persistentWritesAllowed: false`. Mesmo quando todos os cinco testes de coerência passam, a função **não prova a autenticidade das evidências**: os objetos podem ter sido construídos por qualquer chamador. Logo, **nunca** utilizar o campo `evidenceShapeCompatible` como autorização de escrita, de leitura privada ou de divulgação.

A proposta de autorização futura exige validação independente de cinco grupos de evidências, **obtidos pelo backend, não enviados como privilégios pelo cliente**:

1. **Operação específica:** `operationId` único, finalidade exata `PRIVATE_LEGACY_DISCOVERY_PRESERVATION_REVIEW`, projeto `entretenimento-sexual`, destino `legacy_discovery_preference_recovery`, lote máximo já conhecido de 2 candidatos / 8 entradas. Nenhum campo de ativação pública ou saneamento dos perfis originais.
2. **Identidade autenticada:** principal conferido por Firebase Auth Admin SDK, conta não desabilitada e email verificado; token verificado/revogado e autenticação recente, com revalidação no momento da operação. Os timestamps declarados no contrato são apenas pré-condições de formato: devem ter origem confiável no backend, com controle de relógio.
3. **Operador:** documento `users/{operatorUid}` lido no backend, `role: 'admin'` atual, `accountStatus: 'active'`, sem indicadores de exclusão/revogação e com autorização operacional **específica** `privateRecoveryOperator: true`. Esta capability é uma **proposta ainda não provisionada**, não um privilégio existente no projeto.
4. **Revisor independente:** outro administrador ativo, com capability específica `privateRecoveryReviewer: true`. O mesmo UID não pode solicitar/executar e aprovar. Não confiar somente em custom claims antigas ou no token de UI.
5. **Aprovação privada vinculada ao lote:** registro interno de aprovação **ainda não implementado**, com `APPROVED_FOR_REVIEW_ONLY`, mesmo `operationId`, projeto, coleção e contagens, `approvedByUid` diferente de `requestedByUid`, `revokedAtMs/consumedAtMs` nulos e validade máxima de 15 minutos. O status autoriza no máximo **revisão**, nunca migração. Backend futuro deverá impedir leitura/gravação por cliente nas Rules, revalidar aprovação e estado do proprietário **na transação real** e consumir o registro de modo idempotente. Revogação deve bloquear novas tentativas.

**Trilha de auditoria:** `buildLegacyRecoveryAuditEnvelope()` produz **apenas em memória** um envelope agregado com uma das ações `B2_6_PRECHECK_EVALUATED`, `B2_6_PRECHECK_BLOCKED` ou `B2_6_PRECHECK_REJECTED`, `outcome: 'BLOCKED'`, total fixo de 5 evidências, número de itens coerentes de 0 a 5, `writesPerformed: 0`, `persisted: false`. Não contém UID, ID da operação, hash, valores privados, notas livres ou caminho individual. Possui allowlist rígida; valores/ações extras são rejeitados. **Ainda não existe writer backend-only, assinatura da auditoria, TTL ou cadeia imutável de integridade.** Não chamar este envelope de prova durável.

**Retenção:** 30 dias continuam sendo somente proposta para revisão, não prazo legal definitivo, consentimento ou eliminação agendada. Para qualquer persistência posterior, definir minimização, fundamento/finalidade, eliminação verificável por expiração e por exclusão de conta, inclusive subcoleções, revisão de legal hold e proteção contra recriação após purge. O owner deve decidir separadamente se deseja ativar preferências públicas; nenhuma aprovação administrativa substitui essa decisão.

**Barreiras de publicação:** `assertLegacyRecoveryGovernanceMayPersist()` sempre lança `LEGACY_RECOVERY_PERSISTENCE_NOT_AUTHORIZED`; `assertPersistentRecoveryMayExecute()` da B2.2 também continua bloqueando. Não há nova callable, trigger, endpoint, role, regra permitindo acesso, agendador, escrita no Firestore, deploy ou mudança de perfis. As evidências de teste são **inteiramente sintéticas**.

**Validação sem efeitos colaterais:**

```powershell
cd C:\entretenimento
node --test scripts/tests/discovery-legacy-recovery-governance.policy.test.mjs
node --test scripts/tests/discovery-legacy-recovery-persistence.policy.test.mjs
node --test scripts/tests/discovery-legacy-owner-fence.policy.test.mjs
```

A guarda específica também executa testes de governança em Windows e Ubuntu. Esta etapa não executa o runner B2.1, não importa checkpoint e não escreve nem no emulador temporário.

## Fase B2.7 — integração de leitura das fontes de autoridade (sem deploy)

**Código interno não exportado**:
`functions/src/discovery/legacy-recovery-admin-readonly.firestore.ts`.
Testes: `legacy-recovery-admin-readonly.firestore.test.ts` e
`scripts/tests/discovery-legacy-recovery-backend-readonly.contract.test.mjs`.

**Exceção controlada no gate de código órfão:** o módulo B2.7 é
deliberadamente uma biblioteca interna, não um export implantável. A lista
exata `functionsOperationalArtifacts` do
`scripts/quality/check-production-orphans.mjs` registra **somente**
`functions/src/discovery/legacy-recovery-admin-readonly.firestore.ts`
como artefato operacional interno. O teste de contrato exige essa exceção
restrita e confirma a ausência de export pelo `functions/src/index.ts`.
Isso preserva a verificação `--strict` para todos os outros módulos de
Functions. Nenhuma alteração no backend de autorização ou na política de
negação de persistência foi feita para satisfazer o CI.

O método `inspectLegacyRecoveryAdminReadOnly(backend, request, now)`
recebe instâncias Auth e Firestore **injetadas pelo ambiente confiável**.
Não importa `firebaseApp`, não inicializa o SDK, não cria callable/HTTP/
trigger/agendador e **não é reexportado em `functions/src/index.ts`**.
Opera somente com leitura `Auth.verifyIdToken(token, true)` (checagem de
revogação), `Auth.getUser(uid)` (usuário existente, ativo e email verificado)
e `Firestore.collection('users').doc(uid).get()` (papel administrativo
canônico atual, independentemente de claims JWT antigas).

**Restrição de execução:** consulta somente o `process.env` do servidor (não aceita um ambiente fornecido pelo chamador) e, além de não possuir entrypoint, recusa qualquer
contexto fora do conjunto exato `FIRESTORE_EMULATOR_HOST=127.0.0.1:28080`,
`FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:29099`,
`GCLOUD_PROJECT=demo-entretenimento-legacy-governance` e
`FUNCTIONS_EMULATOR=true`, e recusa variáveis de credenciais/projeto
remoto. O projeto lógico da operação continua
`entretenimento-sexual` **apenas como dado contratual**, não é o destino
de execução do leitor. Não há autorização para acesso ao ambiente principal
ou ao banco de produção.

**Fontes e sequência:** verifica assinatura/revogação do ID token e
`auth_time` recente, depois lê o Auth User atual do operador, em seguida
`users/{operatorUid}` e exige `role:'admin'`,
`accountStatus:'active'`, ausência de marcadores de bloqueio/exclusão e
`privateRecoveryOperator:true` (capacidade **ainda proposta e não
provisionada**). Somente após esses gates lê
`legacy_discovery_recovery_approvals/{operationId}` para verificar
o escopo `APPROVED_FOR_REVIEW_ONLY`, projeto lógico, coleção, contagens,
validade/revogação/consumo e o UID de revisor distinto. Consulta novamente
o Auth User e `users/{reviewerUid}`, exigindo administrador ativo e
`privateRecoveryReviewer:true` (também **não provisionada**).
Falhas de Auth, rede, documento, revogação ou contrato retornam relatório
agregado bloqueado e **não expondo JWT, UID ou erros brutos**.

A coleção `legacy_discovery_recovery_approvals` é **proposta**. Nenhum
escritor, migração ou aprovação real foi criado. O fragmento versionado
`firestore-rules/legacy_discovery_recovery_approvals.rules` nega
explicitamente toda leitura e escrita por SDK de cliente, incluindo subcoleções
e claims administrativas; o manifesto canônico de Rules inclui esse fragmento.
`firestore-rules/tests/legacy-discovery-recovery-approvals.rules.spec.ts`
cobre acesso anônimo, operador, revisor, administrador e moderador.
Isso não impede operações do Firebase Admin SDK, que bypassam Rules. A consulta de um documento de aprovação **não prova** que o revisor
autorizou aquela operação, pois faltam um writer confiável, protocolo
antirreplay, autenticação do revisor na emissão, trilha durável de auditoria,
invalidação por revogação e consumo transacional atômico.

**Resultado:** mesmo com todas as verificações sintéticas consistentes, o
método retorna `phase:'B2_7_BACKEND_READ_ONLY'`, `decision:'BLOCKED'`,
`persistentWritesAllowed:false`, `privateRecoveryRead:false`,
`privateRecoveryWritten:false`, `sourceFieldsDeletionAllowed:false` e
`visibilityActivationAllowed:false`. Flags de coerência são somente
evidências parciais, não autorização. Nenhuma leitura de preferências
sensíveis é realizada por este módulo.

**Validação offline obrigatória (sem Auth Emulator real):**

```powershell
cd C:\entretenimento
npm --prefix functions run lint
npm --prefix functions run test
node --test scripts/tests/discovery-legacy-recovery-backend-readonly.contract.test.mjs
node --test scripts/tests/discovery-legacy-recovery-governance.policy.test.mjs
```

Os testes do leitor utilizam dublês de `verifyIdToken`, `getUser` e
`Firestore.get`; demonstram o contrato read-only e a reação a revogação,
roles antigas, contas deletadas, aprovação adulterada e runtime inseguro.
**Não são ensaio real conectado ao Auth Emulator**, que permanece etapa
futura; não alegar prova de emissão de aprovações nem de autenticidade
end-to-end. O teste de contrato também roda no guard Windows e Ubuntu.

**Bloqueios pendentes:** backend writer real continua ausente e vetado,
não existe ledger persistente de aprovação, consumo de uso único, auditoria
durável, retenção/TTL de registros nem autorização de migração. O backfill,
a remoção dos campos originais de `public_profiles` e qualquer deploy
permanecem proibidos.

## Fase B — recuperação privada (NÃO implementada)

1. **Validar proveniência e titularidade:** confrontar os registros com o checkpoint e, se disponíveis, versões históricas; registrar apenas evidências técnicas sem copiar valores para logs.
2. **Avaliar a semântica:** `interestedInGenders` do sistema legado não equivale automaticamente a `hardRules.acceptedGenders` do modelo `PreferenceProfile`. `interestedInOrientations` não possui destino idêntico no contrato atual. Não gerar preferências, filtros recíprocos ou consentimento por inferência.
3. **Desenhar retenção temporária privada:** se necessária, criar antes uma área de recuperação vinculada ao UID e com Firestore Rules explícitas, leitura apenas autorizada e escrita exclusivamente pela rotina administrativa, sem projeção pública ou descoberta; testar tentativas de leitura de terceiros, inclusive bloqueio bilateral.
4. **Garantir reversibilidade:** validar importação isolada do snapshot, registrar hashes de integridade no ambiente protegido e testar dry-run, idempotência e rollback antes de qualquer escrita.
5. **Revisar com o proprietário:** nunca preencher automaticamente `visibility.showPreferenceBadges`, `visibility.showSeekingPublicly` ou `visibility.showIntentPublicly` como `true`; exigir confirmação apropriada antes de ativar projeções.
6. **Somente depois da preservação:** remover cirurgicamente os campos vedados de `public_profiles`, preservando os demais campos. Não reduzir `lacksPrivateDiscoveryInterestFields()` nem relaxar `allow get`.
7. **Pós-condições:** verificar em testes as leituras permitidas/negadas, o bloqueio em ambas direções, os feeds e os deep links em duas sessões; manter Issue #235 aberta até validação real.

## Regras de operação

- **Nenhum deploy, migração persistente ou alteração de Firestore principal/remoto por esta fase.** O ensaio B2.1 grava somente no emulador temporário e exige rollback completo antes de reportar sucesso.
- A primeira etapa não expõe valores; tratar exportações e backups como dados sensíveis.
- O script legado que republicava interesses privados foi aposentado no PR #237, integrado à `main`.
- O backfill administrativo canônico pode apagar esses campos em `public_profiles` e **não deve ser executado em modo de escrita** até conclusão da Fase B.
- CI precisa permanecer verde, inclusive Windows, Ubuntu e verificação de que a lista de campos privados coincide com Firestore Rules e backend.
- Uma aprovação do código de auditoria **não autoriza** a Fase B.

Rastreamento: Issues [#236](https://github.com/entretenimento-sexual/entretenimento/issues/236) e [#235](https://github.com/entretenimento-sexual/entretenimento/issues/235).

## B2.8 - Evidencias de isolamento e integracao

Registro operacional: 2026-11-05.
Referencia inicial: b7bb1f38.
Issue: #236.

### Escopo

Verificar o leitor interno
inspectLegacyRecoveryAdminReadOnly()
utilizando exclusivamente dados sinteticos e os
emuladores Firebase Auth e Firestore.

Projeto descartavel:
demo-entretenimento-legacy-governance.

Auth: 127.0.0.1:29099.
Firestore: 127.0.0.1:28080.

Nenhum checkpoint real deve ser importado.

### Evidencias locais

B2.8.1:
Preflight manual aprovado. Variaveis proibidas
ausentes, portas reservadas livres e leitor interno.

B2.8.2:
Ensaio integrado real aprovado: 10 verificacoes.

Cenarios:
- baseline administrativo valido;
- revogacao de privilegio com JWT antigo;
- revogacao do revisor;
- independencia entre operador e revisor;
- aprovacao expirada;
- aprovacao revogada;
- aprovacao consumida;
- negacao de acesso pelas Firestore Rules;
- conta de operador desabilitada;
- token de autenticacao revogado.

Resultado do leitor: decision BLOCKED.

Persistencia de recuperacao: proibida.
Leitura de preferencias privadas: proibida.
Exposicao publica de preferencias: proibida.
Exclusao de campos de origem: proibida.

B2.8.3:
Sete testes de contrato aprovados.
Preflight aprovado.
Auditoria estrita de orfaos aprovada.

### Integracao CI

O workflow
discovery-legacy-recovery-transaction-guard.yml
passa a incluir verificacao sintatica do executor
e contratos negativos B2.8 em Windows e Ubuntu.

O workflow agora inclui um job de E2E real em Windows e Ubuntu. A execucao remota ainda nao foi comprovada (CI_PENDING).

Esta alteracao local de workflow nao comprova
execucao nem aprovacao no GitHub Actions.

### Limites e pendencias

- B2.8.1 ainda precisa de formalizacao versionada
  completa da politica de isolamento.
- O job E2E foi configurado localmente; sua aprovacao no
  GitHub Actions ainda esta pendente.
- Nao existe emissor confiavel de aprovacoes.
- Nao existe consumo transacional de aprovacao.
- Auditoria persistente e retencao ainda pendem
  de governanca e autorizacao.
- Consentimento do titular nao foi estabelecido.
- Nenhuma migracao ou saneamento dos dados
  legados esta autorizado.

Nao interpretar um resultado PASS como permissao
para modificar dados reais.

### B2.8.4 - Gate E2E real no CI

Configuracao dedicada:
firebase.legacy-governance-e2e.json.

O job real-emulator-e2e usa Node.js 22, Java 21,
Auth e Firestore com portas exclusivas em localhost.

Somente o projeto descartavel
demo-entretenimento-legacy-governance e permitido.

O executor exige bancos vazios, dados sinteticos,
preflight e resultado final BLOCKED.

Nenhum import/export, deploy, acesso produtivo
ou gravacao persistente de recuperacao e autorizado.

Evidencia local: 10 verificacoes integradas aprovadas.
Evidencia remota: CI_PENDING ate execucao no Actions.
## B2.9.1 - Ciclo de vida proposto das aprovacoes

A politica pura `discovery-legacy-approval-lifecycle.policy.mjs` e
seus testes nao acessam Firebase ou arquivos de dados. Esta etapa
nao cria um emissor administrativo, callable, endpoint ou escritor.

Estados somente de proposta: REQUESTED_FOR_REVIEW,
APPROVED_FOR_REVIEW_ONLY, REVOKED, EXPIRED e
CONSUMED_FOR_REVIEW_ONLY. Aprovacao vale somente para revisao.
O prazo de validade e de 15 minutos, com revisor independente.
Revogacao, expiracao e consumo sao estados terminais.

A revisao monotona previne propostas obsoletas apenas quando o
reducer recebe o estado mais recente. Nao ha prova de compare-and-swap
atomico entre processos, nem transacao real Firestore nesta fase.
A autoridade do operador e revisor continua dependendo da futura
verificacao do backend com Auth e users atuais.

O retorno da politica permanece outcome BLOCKED, proposalOnly true,
backendAuthorityVerified false, transactionCommitted false,
approvalPersisted false, auditPersisted false,
persistentRecoveryAllowed false, sourceDeletionAllowed false e
publicVisibilityAllowed false.

B2.7 permanece inalterado. A simulacao de consumo nao grava no
ledger legacy_discovery_recovery_approvals nem permite migrar,
remover ou expor preferencias dos titulares. A janela de retencao,
revogacao de credenciais, trilha persistente e consentimento ainda
exigem contratos independentes e autorizacao expressa.
