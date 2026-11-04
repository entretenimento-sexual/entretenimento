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

## Fase B — recuperação privada (NÃO implementada)

1. **Validar proveniência e titularidade:** confrontar os registros com o checkpoint e, se disponíveis, versões históricas; registrar apenas evidências técnicas sem copiar valores para logs.
2. **Avaliar a semântica:** `interestedInGenders` do sistema legado não equivale automaticamente a `hardRules.acceptedGenders` do modelo `PreferenceProfile`. `interestedInOrientations` não possui destino idêntico no contrato atual. Não gerar preferências, filtros recíprocos ou consentimento por inferência.
3. **Desenhar retenção temporária privada:** se necessária, criar antes uma área de recuperação vinculada ao UID e com Firestore Rules explícitas, leitura apenas autorizada e escrita exclusivamente pela rotina administrativa, sem projeção pública ou descoberta; testar tentativas de leitura de terceiros, inclusive bloqueio bilateral.
4. **Garantir reversibilidade:** validar importação isolada do snapshot, registrar hashes de integridade no ambiente protegido e testar dry-run, idempotência e rollback antes de qualquer escrita.
5. **Revisar com o proprietário:** nunca preencher automaticamente `visibility.showPreferenceBadges`, `visibility.showSeekingPublicly` ou `visibility.showIntentPublicly` como `true`; exigir confirmação apropriada antes de ativar projeções.
6. **Somente depois da preservação:** remover cirurgicamente os campos vedados de `public_profiles`, preservando os demais campos. Não reduzir `lacksPrivateDiscoveryInterestFields()` nem relaxar `allow get`.
7. **Pós-condições:** verificar em testes as leituras permitidas/negadas, o bloqueio em ambas direções, os feeds e os deep links em duas sessões; manter Issue #235 aberta até validação real.

## Regras de operação

- **Nenhum deploy, migração ou alteração do Firestore por esta fase.**
- A primeira etapa não expõe valores; tratar exportações e backups como dados sensíveis.
- O script legado que republicava interesses privados foi aposentado no PR #237, integrado à `main`.
- O backfill administrativo canônico pode apagar esses campos em `public_profiles` e **não deve ser executado em modo de escrita** até conclusão da Fase B.
- CI precisa permanecer verde, inclusive Windows, Ubuntu e verificação de que a lista de campos privados coincide com Firestore Rules e backend.
- Uma aprovação do código de auditoria **não autoriza** a Fase B.

Rastreamento: Issues [#236](https://github.com/entretenimento-sexual/entretenimento/issues/236) e [#235](https://github.com/entretenimento-sexual/entretenimento/issues/235).
