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

## Mapa de informações da visita e autorização (30/10/2026)

Prioridade de descoberta: `identidade → Sobre → O que procura → Quem gostaria de conhecer → Práticas → Como se descreve → Redes → Mídias → Comunidades`. Painéis sem dados autorizados não são fabricados. `Sobre` permanece visível com estado neutro; redes sociais vazias permanecem ocultas. Os links públicos de mídias preservam audiências independentes e não autorizam acesso a qualquer arquivo privado.

| Informação | Origem | Regra de exposição ao visitante |
| --- | --- | --- |
| Apelido, tipo de perfil, orientação individual autorizada, município/UF | Projeção pública canônica | Identidade pública mínima; não inferir orientação de casal nem idade por avatar |
| Apresentação | `publicDescription` | `publicDescriptionVisible === true` no proprietário; nunca consumir `users.descricao` em visitas |
| Tipo de relacionamento procurado | `publicRelationshipIntents` | `visibility.showPreferenceBadges === true` |
| Quem gostaria de conhecer | `publicSeekingGenders` | Ambos `showPreferenceBadges === true` **e** `showSeekingPublicly === true`; ausência/legado = oculto; códigos allowlist |
| Práticas desejadas | `publicSexualPractices` | Opt-in de badges e entitlement **Básico+ vigente do proprietário**, projetado pelo backend |
| Traços próprios | `publicBodyTraits` | Opt-in de badges; não confundir com `softRules.bodyPreferences`, que são preferências de terceiros |
| Redes externas | `public_social_links/{uid}` | Apenas espelho público, assinatura ativa do proprietário e autorização Firestore; leitura bloqueada em ocultação/lifecycle/bloqueio bilateral |
| Status temporário | Consulta específica de intenção | Respeitar audiência, região, expiração, moderação e restrições da consulta; não derivar de visitas ou chat |
| Fotos, vídeos, comunidades | Consultas específicas | Respeitar audiência, vínculo, moderação, propriedade e autorização específicas; não expandir acesso por conta do perfil |

**Campos que continuam privados:** e-mail, dados civis, KYC, comprovação etária, localização exata, limites etários e raio de busca, filtros rígidos, preferências privadas do visitante, parâmetros financeiros e conteúdo de audiência restrita. Não projetá-los para preencher a interface.

**Bloqueio bilateral:** o callable `getPublicProfilesPage` agora verifica bloqueios recíprocos para UID específico, busca, lista e vizinhança. A consulta de perfil visitado ignora cache persistente anterior e revalida a autorização na abertura. As regras do espelho de redes sociais também exigem lifecycle público e ausência de bloqueio.

**Dívida de arquitetura ainda aberta, impeditiva de certificação completa de confidencialidade das preferências:** os campos legados `interestedInGenders`/`interestedInOrientations` continuam trafegando na serialização pública de discovery para sustentar o motor de reciprocidade atual, mesmo quando a exibição de `publicSeekingGenders` não foi autorizada. A nova UI não os utiliza para renderizar a busca, mas isso não deve ser descrito como sigilo de payload. Antes da operação, separar a avaliação recíproca backend da projeção entregue ao cliente, testar que nenhuma preferência privada continua presente no transporte e avaliar impactos no ranking. Não resolver com mera ocultação CSS.

**Validação pendente:** compilações, `test:ci`, suíte Functions, regras Firestore e inspeção com duas contas, incluindo revogação de busca, assinatura expirada, bloqueio em ambas as direções, perfis ocultos e mídia FRIENDS/PUBLIC. Alterações realizadas na `main`, sem branches nem pull requests.

## Reciprocidade confidencial — corte de leitura (30/10/2026)

O `test:ci` do frontend anterior a esta mudança passou com **2.820 testes em 490 arquivos**. Esse resultado **não valida** os commits posteriores desta seção.

**O dado não pode ser protegido só no HTML ou na resposta do callable:** `public_profiles/{uid}` é legível por GET direto quando a conta e o solicitante são elegíveis. A proteção agora exige simultaneamente:

- `syncPublicProfileDiscovery` e o `backfillPublicProfileDiscovery` **removem** as chaves legadas `preferences`, `interestedInGenders`, `interestedInOrientations` e aliases de interesses do documento público com `FieldValue.delete()`.
- As regras negam `get` de terceiros enquanto qualquer dessas chaves existir no documento (fail closed). O dono continua podendo consultar a própria projeção, sujeito aos demais gates.
- `getPublicProfilesPage` serializa só campos públicos e calcula `viewerCompatibilityAllowed`, `viewerCompatibilityScore` e um motivo **agregado** por requisição a partir dos documentos privados de visitante e alvo. Os dados privados nunca entram na resposta.
- O adaptador Angular e o mapper de cards descartam campos legados mesmo diante de um payload antigo; o cache de discovery avança para `v4`. O score do backend substitui a inferência do cliente quando disponível; filtros próprios de idade, distância, assinatura e sinais públicos continuam independentes.
- O código de cálculo backend espelha a política pura do frontend; `functions:build` verifica paridade textual e impede divergência silenciosa.

**Ordem de ativação obrigatória em ambiente de teste:** compilar/testar frontend e Functions; compilar e validar regras; exercitar as regras no emulador; verificar que usuários bloqueados, perfis ocultos, contas com assinatura expirada e usuários com filtros incompatíveis não recebem dados indevidos. Para contas legadas, executar o backfill administrativo com `dryRun=true` antes da escrita. O executor disponível é `npm run admin:discovery-backfill`, com token Firebase administrativo (`FIREBASE_ID_TOKEN`); `--dryRun=false` exige `BACKFILL_CONFIRM_WRITE=YES`. A operação é paginada: concluir **todas** as páginas e conferir documentos sem chaves privadas antes de disponibilizar a migração em produção.

**Efeito transitório intencional:** um perfil legado ainda não saneado pode ficar inacessível a terceiros até seu backfill, em vez de expor preferências. Não substituir essa regra por liberação pública para evitar indisponibilidade. Não executar deploy nem escrita administrativa em produção apenas por ter passado na compilação.
