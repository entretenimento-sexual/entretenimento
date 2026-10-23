# Validação real das pré-condições do Cloud Storage — Media

Esta etapa existe porque o Firebase Storage Emulator não reproduz fielmente `ifGenerationMatch: 0`. Não considerar a execução dos E2E em emulador equivalente a uma certificação do Cloud Storage real.

## Pré-requisitos

- Projeto GCP **exclusivo de testes**, com ID e número verificados pelo operador; nunca utilizar automaticamente o projeto Firebase de produção.
- Bucket **vazio, isolado e não produtivo**, com nome que inclua `test`, `sandbox`, `staging` ou `nonprod`, sem arquivos de usuários, e pertencente ao número do projeto informado.
- Metadados obrigatórios no bucket: rótulo `media_certification=isolated_nonprod`, `publicAccessPrevention=enforced` e `uniformBucketLevelAccess.enabled=true`. Configurar e conferir no Google Cloud Console antes da certificação.
- Credenciais ADC de teste com acesso apenas ao bucket dedicado, incluindo leitura de metadados, listagem de objetos, gravação, cópia e exclusão dos objetos de teste. Não fornecer credenciais ou tokens neste chat.
- Dependências instaladas em `functions/` (`npm ci --prefix functions`).
- Ambiente sem variáveis de emulador configuradas.
- Executar a partir da raiz do repositório, sem deploy.

Exemplo em PowerShell:

```powershell
$env:GOOGLE_CLOUD_PROJECT = "<id-do-projeto-isolado>"
$env:MEDIA_GCS_LIVE_TEST_PROJECT_NUMBER = "<numero-do-projeto-isolado>"
$env:MEDIA_GCS_LIVE_TEST_BUCKET = "<bucket-vazio-isolado-sandbox>"
$env:MEDIA_GCS_LIVE_ACK = "WRITE_ISOLATED_TEST_OBJECTS"
node scripts/quality/verify-media-gcs-live-preconditions.mjs
```

O script verifica primeiro, somente em leitura, a identidade do projeto do bucket, seu rótulo de isolamento, a prevenção de acesso público, o acesso uniforme e a ausência de objetos ativos. Falha antes de escrever se qualquer exigência não for atendida. Não use um bucket que contenha arquivos reais, mesmo que tenha "test" no nome.

O comando cria dois objetos temporários em `__media_precondition_certification/<uuid>` (origem e pôster). Verifica que uma segunda gravação com `ifGenerationMatch: 0` retorna HTTP 412 sem alterar o original; substitui a geração sob pré-condição; tenta uma exclusão com a geração antiga (deve retornar 412); copia o objeto para o pôster com `File.copy` e `ifGenerationMatch: 0`; tenta repetir a cópia (deve retornar 412); e exclui **somente as gerações criadas pelo próprio teste**. A validação **não** executa varreduras, elimina arquivos de usuários ou faz deploy.

O código falha de modo conservador: se o objeto tiver uma geração desconhecida durante a limpeza, não será excluído. O erro identifica o objeto do teste para análise manual. Não desative a condição de geração para recuperar uma falha.

## Critério de aprovação

Exigir `status: passed`, `targetPreflightPassed: true`, `posterCopyRejectedOverwrite: true` e `fixtureDeleted: true` no bucket real, além de Quality Gate canônico, E2E de fotos e vídeos e testes de transação aprovados **no mesmo HEAD**. Depois validar operacionalmente as jornadas de criação, moderação, exposição, revogação, exclusão e recuperação, incluindo revisão de jobs históricos/dead letters, permissões, App Check, observabilidade, cotas e rollback.

Sem a evidência da execução real e a aceitação operacional, **não certificar o Módulo Media para operação**.
