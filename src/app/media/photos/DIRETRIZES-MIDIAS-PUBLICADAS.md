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

## 2.1. Captura direta pela câmera (foto **e** vídeo)

A origem do arquivo — dispositivo, câmera nativa do celular, câmera do navegador ou outro dispositivo — **não altera** o ciclo de vida da publicação:

- Oferecer captura com opção nativa (`input[type=file][capture]`) quando suportada, sem exigir permissão de câmera ao abrir a página. O navegador/dispositivo pode apresentar um seletor de arquivo como alternativa.
- O resultado capturado deve permanecer em memória/preview local e seguir **o mesmo** validador de formato/tamanho, editor, política de audiência, confirmação explícita e serviço de upload das mídias selecionadas da galeria do dispositivo.
- **Nunca** salvar automaticamente a captura como publicação, arquivo de origem permanente, rascunho remoto ou histórico. Cancelar/trocar conta/destruir a tela deve descartar previews temporários e liberar recursos (`ObjectURL`, tracks, listeners).
- Foto capturada: edição opcional no navegador e escolha obrigatória de `PUBLIC` ou `FRIENDS`.
- Vídeo gravado: revisar e confirmar antes do envio, escolhendo explicitamente `PUBLIC` ou `FRIENDS`; tratamento de edição preferencialmente local. Processamento de vídeo que ainda ocorrer no servidor é dívida técnica a migrar e só pode manter temporários pelo tempo operacional estritamente necessário.
- Formatos gerados pela câmera variam entre fabricantes. Arquivos não suportados devem ser rejeitados com mensagem útil pelo validador existente; nunca contornar limites de tamanho/MIME ou a autorização para aceitar a câmera.
- O servidor deve tratar uploads de câmera com **as mesmas regras** de publicação, descarte de staging, limpeza de objetos substituídos e retenção mínima das demais origens.

## 3. Retenção física — invariantes

- Depois da publicação confirmada e da limpeza operacional, **um único arquivo físico ativo representa a mídia publicada**. Não manter simultaneamente cópia privada de origem e cópia publicada, nem versões antigas.
- `assetVersion`, geração GCS e outros identificadores técnicos são metadados de controle de cache, identidade, concorrência e exclusão segura — **não autorização para conservar versões físicas históricas**.
- Ao substituir a mídia, trabalhar com objeto novo validado e troca segura de referência; agendar exclusão da mídia anterior. Um arquivo substituído não vira histórico pessoal.
- **Troca de foto em duas fases**: registrar o upload temporário **não equivale** à publicação confirmada. A interface somente confirma sucesso e libera a origem anterior após a atualização autorizada de `photo_publications.publishedStoragePath` para o novo arquivo. Falhas/timeout não autorizam apagar a origem antiga.
- **Data de exibição da publicação**: o proprietário altera a data por `updatePublishedPhotoDisplayDate` em `photo_publications` usando App Check, rate limit, audiência PUBLIC/FRIENDS, estado de moderação e revisão do ativo. O campo `displayDate` é somente organizacional do proprietário; não altera `public_photos`, score, audiência, arquivo nem `assetVersion`. `null` limpa explicitamente o campo e não reativa data legada. A UI pode ler o valor antigo privado somente como fallback transitório; a gravação nunca depende de `users/{uid}/photos`.
- **Originais privados legados — primeiro preservar**: a ausência de `users/{uid}/uploads/images/*` não justifica apagar `photo_publications` ou `public_photos` quando a publicação ainda existe. A reconciliação de consistência deve consultar a publicação e só chamar a exclusão legada com `onlyIfUnpublished`, revalidada dentro da transação.
- **Prontidão de originais legados**: o diagnóstico `npm run media:legacy-photo:readiness:emu -- --max=150` é exclusivamente para o Emulator Suite local, em modo somente leitura. Nenhuma categoria autoriza exclusão. Registra gerações, referências, moderação, projeção, jobs e dados ainda não migrados em contadores agregados. Testes: `npm run media:legacy-photo:readiness:test`.
- **Galeria proprietária canônica**: a grade do proprietário observa páginas PUBLIC/FRIENDS autorizadas e configurações de `photo_publications`; não observa uploads privados nem solicita URLs dos originais. Datas com `displayDate` canônico prevalecem; datas ausentes caem para `createdAt`. A implantação depende de backfill seguro de datas personalizadas antigas, antes de remoção do legado.
- **Consumidores técnicos legados**: publicação, sincronização, exclusão e manutenção ainda utilizam `users/{uid}/photos`, portanto não existe autorização para remover originais privados. A ausência de origem não autoriza despublicar.
- **Auditoria antes de limpeza**: `scripts/dev/audit-legacy-photo-origins.mjs` funciona exclusivamente contra Firestore/Storage locais, limita a amostra, lê metadados/existência física e mostra somente contadores. O script **não elimina arquivos**. A futura exclusão dos originais requer migrar ações legadas, confirmar a presença do único ativo final, validar geração do original e bloqueios de moderação/retenção em cada tentativa.
- **Edição canônica de foto publicada**: carregar a mídia pela URL temporária autorizada, editar no navegador e enviar somente o resultado final para uma reserva de upload temporária. A substituição é uma operação backend sobre `photo_publications` e `public_photos`, **não** depende de `users/{uid}/photos`. Exigir propriedade, App Check, rate limit, aprovação de moderação, audiência `PUBLIC`/`FRIENDS`, caminho de publicação válido e versão vigente.
- **Reserva e limpeza**: validar a correspondência entre identidade, caminho, MIME, tamanho, metadados e geração do staging. Consumir a reserva na mesma transação que troca a publicação e deixar obrigação durável até limpeza por geração (com retries e dead-letter). Nunca apagar objeto com geração diferente.
- **Sem apagar versões vigentes**: em falha ou corrida, preservar o arquivo publicado anterior e recolher somente a cópia candidata não confirmada. Após troca atômica, enfileirar exclusão do ativo anterior, respeitando a retenção legal/de segurança. `assetVersion` é token de revisão, não catálogo histórico.
- **Triggers de sincronização atrasados**: antes de confirmar uma mídia nova, reler em **transação** a versão atual da origem, publicação e moderação. Se a origem ou publicação mudou, abortar a escrita e limpar apenas a cópia recém-criada, por geração/identidade, sem tocar no arquivo vigente.
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
- [ ] Captura da câmera de foto e vídeo usa o mesmo preview/validação/autorização/publicação; nunca publica ou persiste uma captura automaticamente.
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
