# Validação real das pré-condições do Cloud Storage — Media

Esta etapa existe porque o Firebase Storage Emulator não reproduz fielmente `ifGenerationMatch: 0`. Não considerar a execução dos E2E em emulador equivalente a uma certificação do Cloud Storage real.

## Pré-requisitos

- Bucket **isolado e não produtivo**, com nome que inclua `test`, `sandbox`, `staging` ou `nonprod`; sem objetos de usuários.
- Credenciais ADC autorizadas apenas para os objetos desse bucket de teste.
- Dependências instaladas em `functions/` (`npm ci --prefix functions`).
- Ambiente sem variáveis de emulador configuradas.
- Executar a partir da raiz do repositório, sem deploy.

Exemplo em PowerShell:

```powershell
$env:GOOGLE_CLOUD_PROJECT = "projeto-de-testes"
$env:MEDIA_GCS_LIVE_TEST_BUCKET = "bucket-media-sandbox"
$env:MEDIA_GCS_LIVE_ACK = "WRITE_ISOLATED_TEST_OBJECTS"
node scripts/quality/verify-media-gcs-live-preconditions.mjs
```

O comando cria dois objetos temporários em `__media_precondition_certification/<uuid>` (origem e pôster). Verifica que uma segunda gravação com `ifGenerationMatch: 0` retorna HTTP 412 sem alterar o original; substitui a geração sob pré-condição; tenta uma exclusão com a geração antiga (deve retornar 412); copia o objeto para o pôster com `File.copy` e `ifGenerationMatch: 0`; tenta repetir a cópia (deve retornar 412); e exclui **somente as gerações criadas pelo próprio teste**. A validação **não** executa varreduras, elimina arquivos de usuários ou faz deploy.

O código falha de modo conservador: se o objeto tiver uma geração desconhecida durante a limpeza, não será excluído. O erro identifica o objeto do teste para análise manual. Não desative a condição de geração para recuperar uma falha.

## Critério de aprovação

Exigir `status: passed`, `posterCopyRejectedOverwrite: true` e `fixtureDeleted: true` no bucket real, além de Quality Gate canônico, E2E de fotos e vídeos e testes de transação aprovados **no mesmo HEAD**. Depois validar operacionalmente as jornadas de criação, moderação, exposição, revogação, exclusão e recuperação, incluindo revisão de jobs históricos/dead letters, permissões, App Check, observabilidade, cotas e rollback.

Sem a evidência da execução real e a aceitação operacional, **não certificar o Módulo Media para operação**.
