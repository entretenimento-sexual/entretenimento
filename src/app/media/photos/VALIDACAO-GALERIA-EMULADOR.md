# Registro de validação manual da galeria de fotos — 29/10/2026

Este documento complementa [DIRETRIZES-MIDIAS-PUBLICADAS.md](./DIRETRIZES-MIDIAS-PUBLICADAS.md).
Não altera a regra de produto: **sem galeria privada, sem versões físicas persistentes e sem audiência "somente eu"**.

## Ambiente e amostra

- Projeto do Firebase Emulator Suite: `entretenimento-sexual`, local, não produção.
- Carga de validação `galeria_teste02`: 30 documentos de publicação/projeção e 30 ativos Storage, verificados como **30/30**, com IDs únicos.
- Amostra observada na galeria pública do perfil de teste: 2 fotos originais + 30 imagens artificiais = **32 fotos**.
- Após inserir, foi executado `npm run emu:save`, com checkpoint concluído em `.emulator-data` e backup anterior preservado em `.emulator-data-backups`.
- O teste anterior `galeria_teste01` havia retornado **0/30** após reinicialização de dados; o motivo comprovado do desaparecimento naquela sessão foi a ausência da carga no estado do emulador, não uma falha Angular demonstrada.

## Resultado observado pelo usuário

Todos os **6/6 cenários manuais** passaram na conta visitante autorizada:
1. As 2 fotos originais e as 30 fotos de teste aparecem na galeria.
2. O botão **Carregar mais fotos** permite chegar às 32.
3. Nenhuma imagem é duplicada ao acrescentar páginas.
4. Abrir uma foto mostra a **imagem efetivamente selecionada**.
5. Avanço, retorno e fechamento do viewer funcionam.
6. Fechar o viewer retorna corretamente à galeria.

**Conclusão limitada**: a navegação e paginação da **galeria pública do visitante** foram aprovadas nesse ambiente. Isso não valida a listagem de gestão do proprietário, o ciclo de edição/substituição, a audiência FRIENDS nem o armazenamento físico permanente.

## Regressões que não podem voltar

- Não voltar a carregar a gestão a partir apenas de `users/{uid}/photos`; o acervo de origem é transitório e a publicação social é a autoridade.
- A foto `PUBLIC`/`FRIENDS` deve aparecer conforme permissão real, mesmo sem documento técnico de origem, desde que a publicação e o ativo final sejam íntegros.
- A galeria autorizada não pode enumerar projeção despublicada, moderada ou cuja audiência foi alterada; verificar `photo_publications` ao emitir metadados, e no momento de assinar a URL.
- Paginação deve conservar a ordem, os IDs únicos e o cursor dos registros examinados, inclusive quando projeções antigas são descartadas.
- Manter viewer e retorno aprovados, sem criar novos componentes paralelos de armazenamento.

## Ações pendentes

- Validar manualmente **Fotos do perfil do proprietário** na branch que contém a migração de gestão. As 30 imagens de teste não possuem documentos privados de origem e devem ser representadas corretamente **como publicações**.
- Validar audiência `FRIENDS` com amizade recíproca, não amizade, bloqueio e revogação; o backend é a fronteira de acesso.
- Concluir migração segura de edição/substituição/exclusão e eliminação de originais/versionamentos permanentes; respeitar cleanup por geração, in-flight uploads e retenções de moderação.
- Nenhum teste local ou do GitHub autoriza mesclar automaticamente nem excluir dados existentes.

**Este arquivo registra um teste manual informado pelo usuário; não representa certificação automática ou aprovação de deploy.**
