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
- Retorna um relatório de pré-condições com decisão `BLOCKED` e seis bloqueadores não configuráveis pelo chamador: autenticação administrativa **verificada em backend**, autorização explícita da operação, integração ao expurgo de conta, mecanismo de expiração, escritor de auditoria backend-only e aprovação de migração/rollback persistente. O relatório de auditoria é estritamente agregado, com campos permitidos, sem UID, valores, hashes individuais ou texto livre.
- `assertPersistentRecoveryMayExecute()` **sempre rejeita** execução persistente. Não existe CLI de persistência, callable, endpoint, trigger, cron, writer, rotina de expurgo, regra de autorização ou deploy neste commit. A ausência desses componentes é proposital.

**Governança exigida para um eventual writer futuro** (não implementada aqui):

1. Verificar a identidade do operador e o papel administrativo em fonte de autoridade *server-side*, conferir conta ativa e privilégios atuais, e registrar autorização específica para cada lote. Não aceitar `admin: true` nem booleanos de aprovação enviados pelo cliente como prova.
2. Validar a origem no banco no momento da operação, cotejar o checkpoint e sua proveniência, conferir versão das Rules, hashes e conflitos; a transação deve continuar restrita à quarentena backend-only.
3. Criar trilha de auditoria mínima com garantias de integridade e acesso interno; impedir valores sensíveis, UIDs brutos e hashes individualizados em logs/telemetria.
4. Definir base jurídica, finalidade, retenção mínima necessária e caminho real de expiração/eliminação, incluindo exclusão da conta e solicitações de titular. O TTL de 30 dias é somente uma proposta.
5. Testar transação e rollback **com o emulador isolado**, incluindo falhas entre cópia, verificação e exclusão, antes de considerar qualquer execução persistente.
6. Exigir decisão independente do proprietário para interpretar/ativar preferências; preservação privada não equivale a consentimento de descoberta pública.

**Operação:** testar apenas a política com `node --test scripts/tests/discovery-legacy-recovery-persistence.policy.test.mjs`. O workflow de guarda também a executa em Windows e Ubuntu. Não executar backfill administrativo nem remover campos públicos durante a preparação.

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
