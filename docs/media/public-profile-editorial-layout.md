# Perfil visitado e galeria — composição visual editorial

**Revisão: 30/10/2026.** Referências: capturas do perfil visitado `serale` e da galeria pública enviadas pelo usuário. O objetivo não é apenas aumentar fonte ou reduzir chips: o espaço e as mídias precisam formar uma composição clara.

## Direção visual

- Interface escura e discreta, com profundidade suave, bordas com pouco contraste e um único acento da cor de marca. Não usar selos decorativos de verificação, textos artificiais de popularidade, avaliações ou estados de relacionamento inferidos.
- **Hero do perfil visitado**: retrato público em destaque, apelido em H1, metadados canônicos mínimos e ações reais. Foto e identidade compartilham uma superfície ampla; responsividade empilha o retrato no celular. Sem idade exata e sem dados privados.
- **Mídia primeiro**: a prévia de cinco itens utiliza mosaico 2+4 no desktop — um bloco maior e quatro menores. Com menos de cinco, mantém a grade uniforme. Em telas médias/pequenas, a primeira posição vira faixa larga seguida de uma grade de duas colunas. Nenhuma mídia nova é consultada, nem a ordem pública ou o item que abre no visualizador é alterado. Cartões de vídeos preservam poster inteiro e duração; fotos usam `object-fit: cover` apenas na prévia.
- **Informações secundárias**: descrição, afinidades, desejos e disponibilidade autorizados continuam condicionais, mas aparecem **depois** do painel de mídia, em blocos responsivos. A ausência desses dados não deixa uma coluna vazia ao lado da galeria.
- **Galeria completa**: grade pública de fotos permanece uniforme e ordenada; o cabeçalho de identidade tem presença visual e as imagens aproveitam melhor a largura disponível. Nada de promover automaticamente a primeira foto, usar masonry, ocultar autor, nem misturar álbum privado. O rodapé exibe somente dados relevantes.
- **Navegação e segurança**: links para fotos/vídeos, visualizador, retorno e botões de denúncia/conversa/interesse mantêm as rotas e permissões já implementadas. Os alvos de toque têm no mínimo 44 px, foco visível e contraste em alto contraste.

## Critérios de verificação

1. Perfil visitado ocupa a área útil do shell sem o corredor em branco causado pela coluna lateral; hero com respiro, mídia em largura integral e painéis opcionais abaixo.
2. Cinco mídias, duas mídias e uma mídia apresentam layouts válidos; primeira mídia não muda de identidade nem de posição no viewer. O comportamento de carregamento, moderação e bloqueio bilateral permanece sob a camada de acesso pública.
3. Galeria mostra fotos uniformes e sem rolagem horizontal, inclusive com sidebar aberta, entre 360 e 1600 px de largura útil. `Carregar mais fotos` preserva paginação e cursor.
4. Design responsivo para 390, 430, 768, 1024, 1360 e 1600 px; modo claro, escuro, alto contraste, redução de movimento, teclado e toque.
5. Testes de código e CI não substituem revisão visual real em navegador e dispositivo móvel. Esta revisão de layout não autoriza deploy.

A identidade dos perfis segue `docs/architecture/PUBLIC_USER_VISUAL_IDENTITY_CANONICAL.md`. A galeria segue `docs/media/photo-gallery-visual-contract.md`.
