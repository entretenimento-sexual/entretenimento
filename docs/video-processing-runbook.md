# Processamento de vídeos

Este documento descreve a ativação operacional do pipeline de vídeos. O código
não deve ser publicado antes da validação no ambiente de staging.

## Arquitetura

```text
upload privado
  -> registro backend
  -> media_video_processing_jobs
  -> Google Cloud Transcoder
  -> users/{uid}/processed/videos/{videoId}/{version}/
  -> revisão administrativa
  -> cópia publicada controlada
```

O original bruto permanece privado. Visitantes nunca recebem seu path ou URL.
Somente um derivado confirmado como MP4 ou WebM pode ser copiado para o
namespace publicado.

## Pré-requisitos do projeto Google Cloud

1. Confirmar faturamento ativo no projeto de staging.
2. Habilitar a Transcoder API:

```powershell
gcloud services enable transcoder.googleapis.com --project=<PROJECT_ID>
```

3. Identificar a service account efetivamente usada pelas Functions de segunda
geração. Não presumir o endereço; conferir a configuração implantada.
4. Conceder a essa service account permissões para criar, consultar e excluir
jobs do Transcoder. O papel predefinido que cobre essas operações é:

```text
roles/transcoder.admin
```

5. Confirmar que o service agent do Transcoder possui acesso aos objetos do
bucket. Em projetos sem restrição adicional, esse acesso é provisionado pelo
Google ao criar o primeiro job. Em buckets endurecidos, conceder ao service
agent apenas o acesso necessário ao bucket de mídia.

## Variáveis opcionais

```text
VIDEO_TRANSCODER_LOCATION=us-central1
VIDEO_TRANSCODER_TEMPLATE_ID=preset/web-hd
```

Sem configuração explícita, o código utiliza a região canônica das Functions e
o preset oficial `preset/web-hd`.

## Estados persistidos

```text
QUEUED
SUBMITTING
PROCESSING
SUCCEEDED
FAILED
CANCEL_REQUESTED
CANCELLED
```

O documento privado apresenta ao usuário os estados reduzidos:

```text
queued
processing
ready
failed
```

## Critérios antes do deploy

- lint e build de Functions aprovados;
- build Angular aprovado;
- regras de Storage revisadas;
- API e IAM configurados somente em staging;
- upload de MP4, WebM e MOV testado;
- vídeo com menos de cinco segundos rejeitado;
- falha transitória testada sem duplicar job;
- exclusão durante processamento testada;
- derivado confirmado como reproduzível em Chrome, Firefox, Safari e Edge;
- publicação bloqueada enquanto não houver `processedStoragePath`;
- moderação aprovada e rejeitada testadas;
- custos e quotas do Transcoder acompanhados.

## Observação de segurança

Não habilitar `MEDIA_AUTO_APPROVE_VIDEOS=true` em produção. Processamento técnico
não substitui moderação humana de conteúdo.
