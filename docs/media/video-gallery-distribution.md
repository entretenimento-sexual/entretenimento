# Módulo Media — Galeria, reprodução e distribuição de vídeos

## Contratos comuns

- A biblioteca privada do proprietário é gerenciada pelo `ProfileVideoLibraryFacade`, seu NgRx e a consulta canônica de vídeos do titular. A ordem inicial é a da biblioteca (mais recentes primeiro); o filtro de status é **apenas uma projeção de interface**, não grava novos campos nem altera ranking.
- O proprietário vê `Todos / Publicados / Não publicados`. Preparação, revisão, falha e moderação não são playback público. A miniatura preserva o formato com `object-fit: contain`.
- Para **qualquer terceiro**, vinculado ou não, e visitantes anônimos, a galeria de vídeo implementada é a **galeria pública aprovada**. Apenas `visibility = PUBLIC` e `moderationStatus = APPROVED` entram no launcher, com acesso renovado no backend. Não existe autorização implícita de vídeo privado decorrente de vínculo.
- A plataforma **não deve inferir** uma audiência `FRIENDS` de vínculos para vídeos: uma funcionalidade restrita a vínculos exigiria contrato de publicação, regras, backend e testes específicos antes de expor qualquer arquivo.
- A montagem do card não contém URL permanente de mídia. Capa temporária pode ser hidratada como preview e o playback solicita acesso sob demanda.
- A identidade de um vídeo é `(ownerUid, videoId)`; nunca avançar para item diferente quando um item da sessão foi ocultado, revogado ou excluído.

## Matriz de espaços

| Espaço | Fonte e organização | Exibição e retorno |
| --- | --- | --- |
| Meus vídeos | `/media/videos`; biblioteca privada, status e ordem da fonte | PUBLIC + APPROVED usa o visualizador público; vídeos prontos não públicos usam prévia privada do proprietário com URL assinada temporária, sem distribuição; fechar restaura foco, scroll e filtro |
| Galeria pública do perfil | `/media/perfil/:id/videos-publicos`; paginação pelo backend com janelas de render limitadas | Grid responsivo, navegação anterior/próxima, reprodução no viewer da galeria |
| Link direto de vídeo | `/media/video/:ownerUid/:videoId` | Visualizador usa autorização pública; o link de retorno abre a galeria completa daquele perfil |
| Mosaico de perfil próprio ou visitado | `ProfileMediaShowcaseComponent`; janela curta de fotos e vídeos públicos | Modal misto com ordenação e handoff preservados; acesso às galerias completas por tipo |
| Destaques de vídeo no Explore | `SocialExplorePage`; cartões verticais de vídeo publicados | Viewer com fonte `discover`, retorno ao carrossel; autor é roteado corretamente ao seu próprio perfil |
| Feed pessoal e de atualizações | Cards públicos de foto/vídeo vindos do serviço de distribuição | Modal misto; preserva a posição no feed ao fechar e respeita fronteira de exposição por item |
| Outros perfis, vinculados ou não | Os componentes públicos recebem `ownerUid` e contexto de visualizador | Exposição pública igual para ambos, salvo verificações de bloqueio/idade/autorização no backend |

## Critérios operacionais da galeria

1. Publicado: seleção mantém o `videoId` original após filtrar itens revogados; não substitui automaticamente por vizinho.
2. Fechar: fecha modal, pausa playback, restaura foco; não destrói a página ou seu scroll e não duplica visualizadores por cliques simultâneos.
3. Anterior/próximo: seguem a ordem fornecida pelo backend na galeria; não reorder client-side uma página parcial como se fosse todo o catálogo.
4. Capa: `contain` dentro do quadro 16:9 (ou 9:16 nos destaques) evita cortar retratos; o vídeo real usa `object-fit: contain`.
5. Privacidade: após mudar audiência, moderação, bloqueio ou exclusão, negar novas sessões, assinaturas e interações não autorizadas.
6. Responsividade: botões com alvo mínimo de 44px; navegação por teclado, Escape, foco e leitores de tela testados em mobile/desktop.
7. Distribuição: um mesmo vídeo pode estar no perfil e em feed/destaque; cada exposição deve conservar a origem para telemetria e as mesmas regras canônicas de acesso.

## Aceitação pendente

Esta matriz descreve contratos de código e cenários de UX, **não** uma inspeção visual concluída. Validar manualmente em homologação dimensões portrait/landscape, Android/iOS/desktop, retorno por Escape, botão de fechar, botão Voltar, teclado, perfis vinculados/não vinculados, bloqueio bilateral, sessão anônima, expiração de URL e feed longo. Não liberar operação sem a validação real do Cloud Storage e os gates do documento `operational-acceptance.md`.
