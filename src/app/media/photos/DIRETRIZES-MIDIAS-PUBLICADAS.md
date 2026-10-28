# Diretrizes obrigatórias — fotos publicadas (e equivalentes para vídeos)

> **Regra de produto permanente e vinculante para o módulo Media do Sexo é o Limite.**
> Antes de propor ou alterar upload, edição, publicação, galeria, viewer, moderação, substituição, exclusão, Storage ou Firestore, ler este documento. Não reinterpretar a plataforma como serviço de armazenamento pessoal.

## 1. Princípio fundamental

O produto é uma rede social com publicações de fotos e vídeos para audiências autorizadas, **não é um drive, backup, álbum privado ou biblioteca de arquivos do usuário**.

Uma mídia mantida como publicação ativa deve ter alguma audiência social **além do próprio proprietário**. O autor tem direito de administrar/ver suas próprias publicações, mas isso **não cria** um modo de visibilidade **“somente eu”**.

- Audiências para novas publicações: `PUBLIC` (público permitido pela política de acesso) ou `FRIENDS` (somente conexões/amigos autorizados). Ampliar audiências exige nova decisão de produto, validação de entitlement e autorização de backend.
- **Proibido:** `ONLY_ME`, `PRIVATE` como opção final de publicação, galeria privada de armazenamento, “salvar para depois” como arquivo permanente, ou usar o Storage para guardar originais/versionamentos sem finalidade operacional.
- Estados legados `PRIVATE` ou documentos técnicos de upload em preparo **não são publicações** e não podem ser exibidos como galeria pessoal.

## 2. Seleção e tratamento

1. O usuário seleciona arquivo no próprio dispositivo.
2. Edição é opcional e acontece no navegador/ambiente local (corte, rotação, correções, histórico de edição). **Não persistir histórico de edição ou versões intermediárias nos servidores**.
3. O upload envia a mídia **final, já tratada**, com audiência obrigatoriamente definida.
4. É permitido staging técnico temporário enquanto validação, processamento, publicação, rollback ou retry responsável estiver em curso. Deve ter limite temporal curto e limpeza automática; não transformá-lo em funcionalidade de acervo pessoal.
5. Upload não concluído/publicação recusada deve entrar no fluxo canônico de expiração/limpeza. Não conservar conteúdo indefinidamente por conveniência de UX.

## 2.1. Câmera do dispositivo (fotos e vídeos)

A origem do arquivo **não altera** o contrato de publicação: seleção de galeria, câmera nativa do celular e câmera do navegador devem entregar mídia final ao mesmo validador, editor local e publicador.

- **Foto capturada direto da câmera:** `PhotoUploadComponent` recebe o `File` em `onFileSelected()`, valida formato/tamanho, abre prévia local, deixa a edição opcional, exige a escolha `PUBLIC`/`FRIENDS` e somente publica após ação explícita. Não realizar upload só por capturar uma imagem.
- **Vídeo gravado direto da câmera:** `ProfileVideosComponent` recebe o `File` em `onVideoSelected()` e passa pela validação e pelo editor local canônicos. É necessário confirmar o envio. O fluxo atual de vídeo publica em `PUBLIC`; **a opção FRIENDS para vídeos exige atualização coordenada de backend, viewer e políticas antes de ser exposta na UI**. Não oferecer uma opção fictícia.
- **Foto capturada no Mural comunitário:** `CommunityCameraCaptureComponent` usa `CameraCaptureService` e entrega somente um `CommunityComposerImageAttachment` local ao composer. O Mural é uma publicação no espaço comunitário, **não** uma nova galeria de perfil. Não enviar automaticamente ao Storage ao clicar em "Capturar" ou "Usar foto".
- **Vídeo no Mural:** o composer atual só suporta anexos de imagem; não sugerir suporte de vídeo por câmera no Mural enquanto não existir contrato de publicação e autorização adequado.
- Capturas não confirmadas, arquivos selecionados, blobs e `object URLs` devem ser descartados ao cancelar, trocar identidade ou destruir a UI; interromper todas as `MediaStreamTrack` ao fechar. Não usar cache durável para rascunhos capturados.
- Se o navegador não suportar `capture`/câmera nativa, preservar o seletor convencional. Os atributos HTML de captura são **dicas ao dispositivo**, não prova de origem nem autorização de upload.
- Formato/códec não suportado ou falha de câmera deve passar pelos mesmos erros centralizados e mensagens acessíveis; jamais aceitar arquivo sem a validação normal por ser capturado localmente.
- Edição local pode mudar o arquivo final, mas versões anteriores não devem ser enviadas ou retidas no backend. Capturar/recapturar não cria publicação.
- Aplicar essas regras tanto a fotos quanto a vídeos ao evoluir os módulos.

## 3. Retenção física — invariantes

- Depois da publicação confirmada e da limpeza operacional, **um único arquivo físico ativo representa a mídia publicada**. Não manter simultaneamente cópia privada de origem e cópia publicada, nem versões antigas.
- `assetVersion`, geração GCS e outros identificadores técnicos são metadados de controle de cache, identidade, concorrência e exclusão segura — **não autorização para conservar versões físicas históricas**.
- Ao substituir a mídia, trabalhar com objeto novo validado e troca segura de referência; agendar exclusão da mídia anterior. Um arquivo substituído não vira histórico pessoal.
- Excluir publicação implica remover projeção e objeto publicado conforme o ciclo canônico e reexecução de limpeza; não confiar em exclusão apenas da UI.
- Arquivos/derivações adicionais só podem existir se forem temporários e necessários ao processamento, ou se houver obrigação legal/de segurança formalizada e separada do conteúdo visível ao usuário.
- Evidências em `system/moderation-evidence`, quarentena legal e retenção obrigatória **não são galeria privada** e seguem política própria, com proteção de geração/identidade, auditoria e expiração conforme obrigação. Jamais apagá-las como efeito colateral de limpeza de staging.
- Não apagar originais legados em massa até migrar dependências de edição, exclusão, moderação e rotinas de retry. Migração deve ser verificável e reversível antes da eliminação física.

## 4. Modelo de dados e autorização

- Uma publicação social é a **fonte de verdade** de proprietário, audiência, estado, moderação e ativo final.
- Projeções Firestore são metadados de leitura/ordenação; **não são arquivos adicionais**.
- Gestão do proprietário e galeria de visitantes devem refletir as **mesmas publicações**, diferenciando apenas ações e permissão de acesso; nenhuma lista deve ser alimentada exclusivamente pelo acervo temporário de origem.
- Para fotos, reutilizar as consultas autorizadas do backend (inclusive `PUBLIC` e `FRIENDS`) e URLs assinadas temporárias. Não confiar no filtro do cliente como fronteira de segurança.
- A identidade de abertura/interação no viewer é `ownerUid + photoId`; validar seleção correta, acesso vigente, URLs expiradas, ordenação, paginação, deduplicação e troca de usuário.
- Usuário proprietário pode gerenciar suas publicações (capa, audiência, substituição, exclusão) sem depender de uma biblioteca privada permanente.

## 5. Regras para mudanças de código

- Priorizar **Observables/RxJS**, reatividade e cancelamento quando identidade/sessão muda.
- Preservar nomes de métodos e contratos públicos onde possível, manter acessibilidade e evitar duplicação de consultas.
- Centralizar reporte de falhas em `global-error-handler.service.ts`, `error-notification.service.ts` e limites canônicos do módulo (ex.: `MediaApplicationErrorService`). Não duplicar notificações do mesmo erro.
- Manter regras de autorização, prevenção de abusos, moderação reativa, preservação de evidências e exclusão por geração segura.
- **Não criar** novas coleções, cópias físicas, galerias ou serviços redundantes para contornar uma divergência de UI.
- Revisar **fotos e vídeos** ao mudar política de retenção.

## 6. Critérios mínimos de aceite

- [ ] Seleção/edição local; histórico de edição não gravado no backend.
- [ ] Apenas `PUBLIC`/`FRIENDS` para novas publicações e nenhuma opção “somente eu”.
- [ ] Staging tem expiração, limpeza automática e não é navegável como álbum.
- [ ] Após confirmação da publicação e reconciliação, existe **um único objeto físico ativo**, sem original privado ou versão histórica redundante.
- [ ] Substituir, remover e reprocessar não acumulam versões físicas; retries usam identidade e geração fixadas.
- [ ] Guardas de segurança/evidência legal preservados e isolados do armazenamento do usuário.
- [ ] Proprietário e visitantes autorizados veem a mesma publicação, conforme audiência e moderação.
- [ ] Paginação agrega sem remover ou duplicar itens; viewer abre a foto solicitada.
- [ ] Testes de regras, fluxos, CI e emuladores passam antes da integração à `main`.

## 7. Dívida técnica detectada (não confundir com solução aprovada)

Em outubro de 2026, ainda existem caminhos `users/{uid}/photos` com originais técnicos, `photo_publications.sourceStoragePath` e cópia para `publishedStoragePath`, além de métodos de edição/exclusão que dependem dessa origem. **São mecanismos legados a migrar, não funcionalidades a preservar como galeria pessoal.**

A migração segura precisa tratar upload, publicação transacional, armazenamento definitivo, substituição, deleção, trabalhos pendentes e moderação **antes de remover a origem privada**. Nenhuma etapa isolada deve eliminar bytes de maneira não recuperável.

Estas diretrizes refletem a decisão explícita de produto e têm precedência sobre comentários legados que descrevam “biblioteca/acervo privado do usuário” como objetivo funcional.
