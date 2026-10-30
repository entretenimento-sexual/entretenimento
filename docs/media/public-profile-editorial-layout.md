# Perfil visitado e galeria — composição visual editorial

**Revisão: 30/10/2026.** Referências: capturas do perfil visitado `serale` e da galeria pública enviadas pelo usuário. O objetivo não é apenas aumentar fonte ou reduzir chips: o espaço e as mídias precisam formar uma composição clara.

## Direção visual

- Interface escura e discreta, com profundidade suave, bordas com pouco contraste e um único acento da cor de marca. Não usar selos decorativos de verificação, textos artificiais de popularidade, avaliações ou estados de relacionamento inferidos.
- **Hero do perfil visitado**: faixa curta com gradiente discreto de marca e **avatar público circular sobreposto**, apelido em H1, identidade pública mínima, ações reais de interesse/conversa. A apresentação pública autorizada aparece logo abaixo, na seção Sobre. Cabeçalho deliberadamente compacto no desktop e no celular; não dedicar meia tela a uma capa vazia. Sem idade exata, nome civil, indicadores inventados ou dados privados.
- **Mídia primeiro**: a prévia de cinco itens utiliza mosaico 2+4 no desktop — um bloco maior e quatro menores. Com menos de cinco, mantém a grade uniforme. Em telas médias/pequenas, a primeira posição vira faixa larga seguida de uma grade de duas colunas. Nenhuma mídia nova é consultada, nem a ordem pública ou o item que abre no visualizador é alterado. Cartões de vídeos preservam poster inteiro e duração; fotos usam `object-fit: cover` apenas na prévia.
- **Apresentação antes das mídias**: a seção Sobre mostra a descrição com autorização explícita e os interesses já autorizados antes do mosaico. Na ausência de descrição, informa que não há apresentação publicada, sem fabricar dados. Desejos comparados e disponibilidade continuam condicionais após a galeria, sem coluna vazia.
- **Galeria completa**: grade pública de fotos permanece uniforme e ordenada; o cabeçalho de identidade tem presença visual e as imagens aproveitam melhor a largura disponível. Nada de promover automaticamente a primeira foto, usar masonry, ocultar autor, nem misturar álbum privado. O rodapé exibe somente dados relevantes.
- **Navegação e segurança**: links para fotos/vídeos, visualizador, retorno e botões de denúncia/conversa/interesse mantêm as rotas e permissões já implementadas. Os alvos de toque têm no mínimo 44 px, foco visível e contraste em alto contraste.

## Critério de produto para encontros entre adultos

As imagens de referência mostram recursos comuns de redes sociais (capa, avatar sobreposto, abas e ações). **A adaptação não replica nem expande** um feed generalista: o Entretenimento prioriza descoberta de perfis, intenção pública autorizada, interesse, conversa, fotos e vídeos. O visual deve ser limpo, compacto e distinto, sem mural, seguidores, popularidade fabricada, foto de capa inferida, sexualidade presumida ou perfis de menores.

A moderação preventiva, a checagem confiável de elegibilidade adulta, o bloqueio bilateral e a audiência pública explícita permanecem controles separados da identidade visual. A capa é **gradiente CSS**, não uma mídia privada escolhida automaticamente.

## Camada social de navegação

O perfil visitado apresenta retorno à descoberta, **nome**, metadados canônicos mínimos, **apresentação pública opcional** e **ações reais de conexão ou conversa**. A navegação compacta utiliza **Perfil / Fotos / Vídeos / Sobre**: as duas galerias usam rotas existentes, e `Sobre` aponta a conteúdo autorizado na mesma página quando disponível. A descrição aparece uma única vez na seção Sobre, antes das mídias.

As galerias públicas de fotos e vídeos usam o mesmo caminho visual `Perfil / Fotos / Vídeos` e identificam a seção atual. Os links resolvem as rotas já existentes; no vídeo, o retorno ao perfil próprio ou visitado mantém a distinção de proprietário. O estado ativo não é uma interação falsa.

A camada é de apresentação: **não** criar recursos de seguidores, popularidade, curtidas, chat aberto, status verificado ou recomendações inventadas. Os estados de amizade, online e moderação dependem exclusivamente dos dados já autorizados. Perfil de casal não recebe orientação individual agregada. Não carregar arquivos originais ou dados privados para embelezar a UI.

## Critérios de verificação

1. Perfil visitado ocupa a área útil do shell sem corredor vazio; cabeçalho compacto com avatar circular sobre faixa de cor discreta, bio e ações de interesse/conversa, mídia em largura integral e painéis opcionais abaixo.
2. Cinco mídias, duas mídias e uma mídia apresentam layouts válidos; primeira mídia não muda de identidade nem de posição no viewer. O comportamento de carregamento, moderação e bloqueio bilateral permanece sob a camada de acesso pública.
3. Galeria mostra fotos uniformes e sem rolagem horizontal, inclusive com sidebar aberta, entre 360 e 1600 px de largura útil. `Carregar mais fotos` preserva paginação e cursor.
4. Design responsivo para 390, 430, 768, 1024, 1360 e 1600 px; modo claro, escuro, alto contraste, redução de movimento, teclado e toque.
5. Testes de código e CI não substituem revisão visual real em navegador e dispositivo móvel. Esta revisão de layout não autoriza deploy.

A identidade dos perfis segue `docs/architecture/PUBLIC_USER_VISUAL_IDENTITY_CANONICAL.md`. A galeria segue `docs/media/photo-gallery-visual-contract.md`.

## Consentimento explícito para a apresentação (30/10/2026)

O campo privado `users/{uid}.descricao` **não é consumido diretamente** pelo perfil visitado. O proprietário decide em Editar dados se deseja publicá-lo. O consentimento `publicDescriptionVisible` tem padrão `false`, inclusive para cadastros antigos. Quando verdadeiro, a sincronização backend sanitiza o texto, limita-o a 2.000 caracteres e publica somente `public_profiles/{uid}.publicDescription`. Quando retirado, a projeção passa a `null`. O endpoint `getPublicProfilesPage` e a hidratação pública aceitam exclusivamente `publicDescription`; `descricao` privado ou aliases legados não são atalhos de publicação.

A apresentação fica imediatamente abaixo da identidade/ações e antes do mosaico. Preferências só aparecem quando a visibilidade pública está autorizada. Distância é exibida apenas quando já está autorizada pela consulta. Perfis que não optaram pela publicação informam a ausência de apresentação, sem transformar orientações, intenções ou características em afirmações presumidas.

Fluxo de trabalho: alterações realizadas diretamente em `main`, sem criação de branches ou pull requests. Publicação e revisão visual real continuam exigindo validação específica e não são inferidas apenas do código.
