# Galeria pública de fotos — contrato visual e de navegação

**Revisão: 29/10/2026.** Referência de avaliação: captura da galeria pública de `serale` enviada pelo usuário. A captura não comprova comportamento responsivo em celular ou autorização de mídia no servidor.

## Objetivo

A galeria do perfil é uma **coleção de fotografias**, não um feed de publicações. A imagem deve ser protagonista, com cards de tamanho uniforme, metadados discretos e identificação do proprietário no cabeçalho de perfil por `app-public-user-identity`. Nunca ampliar automaticamente a primeira imagem, alterar a ordem por capa ou introduzir masonry.

## Composição canônica

- **Largura e grade**: CSS container `public-photos-gallery`; 1 coluna abaixo de 420 px, 2 colunas de 420 a 799 px, 3 de 800 a 1159 px, 4 a partir de 1160 px, preservando colunas iguais e o limite do page shell. Pontos de quebra baseados no espaço útil, não apenas na viewport (a sidebar pode estar aberta).
- **Imagem**: card uniforme em proporção 4:5, botão para abrir o viewer da foto selecionada. O rodapé não cobre a foto. Não reconstruir originais nem manter versões privadas.
- **Rodapé da variante `profile`**: mostrar somente curtidas, comentários e visualizações com contagem positiva. O horário de publicação permanece visível quando há data; selo de capa somente para `isCover`. Com contadores zerados, evitar a sequência de chips 0/0/0. As variantes `feed`, `latest`, `top` e `sponsored` não herdam esta regra visual.
- **Identificação**: apelido, código de perfil, orientação autorizada e município/UF no cabeçalho por `PublicUserIdentityComponent`. A orientação agregada de casal não pode ser inferida. Não repetir proprietário em cada thumbnail.
- **Acessibilidade**: botão da imagem com nome acessível; métricas positivas com contagem no `aria-label`; ações reais com alvo mínimo 44 px, foco visível, suporte a teclado e movimento reduzido. O texto de data e o contraste do rodapé devem ser verificados em telas pequenas.
- **Paginação**: lotes iniciais 8/12/24 alinhados aos dois primeiros limiares da grade; `Carregar mais fotos` segue explícito e preserva cursor, deduplicação, proprietário, troca de rota e retorno do viewer.

## Critérios de aceitação

1. Grade uniforme sem scroll horizontal, fotos corretamente recortadas e sem elementos soltos no rodapé em larguras de conteúdo de 360, 390, 430, 768, 800, 1024, 1160 e 1320 px.
2. Card de foto com métricas 0/0/0 não mostra chips zerados; cards com números positivos preservam contagens e data. Feed não muda.
3. Carregamento incremental alcança todas as fotos, sem repetição, e abre exatamente a imagem clicada; navegação anterior/próxima/fechar retorna à galeria.
4. Visitante sem permissão, bloqueio bilateral e mídia revogada não são contornados por cache ou pelo layout; comportamento depende das verificações existentes de backend e regras.
5. Revisão visual real em dispositivos desktop/móveis e alto contraste permanece necessária. Testes de código, CI e a captura fornecida não substituem essa verificação.
