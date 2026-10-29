# Identidade visual pública canônica — Sexo é o Limite / Entretenimento

**Status (29/10/2026):** contrato mínimo consolidado; chat, comunidades, galerias e visualizadores de fotos/vídeos, perfil visitado, cards de descoberta e superfícies principais do Explore usam a identidade canônica. A certificação de CI e a inspeção em dispositivos reais são etapas separadas. Este documento não certifica autorização de produção.

## Finalidade

Permitir que adultos reconheçam **quem publicou ou interagiu**, **qual é o tipo declarado de perfil** e, quando publicamente informado, **a orientação sexual**, sem transformar cada lista em um minicadastro. O cabeçalho público identifica, mas **não autentica**, comprova idade, disponibilidade, intenção, profissão ou compatibilidade sexual.

**Autoridade visual:** `src/app/core/components/public-user-identity/PublicUserIdentityComponent` (`app-public-user-identity`). **Autoridade de dados:** `PublicUserIdentity` / `normalizePublicUserIdentity` em `src/app/core/domain/public-user-identity/`. **Autoridade dos códigos de tipo de perfil:** `config/profile-identity-catalog.json` (com arquivo TypeScript gerado; nunca inventar códigos ou editar o catálogo gerado).

## Linha de apresentação mínima

Exemplo individual com campos efetivamente publicados:

> **serale**  
> Mulher · Hétero · Rio de Janeiro/RJ

Outro exemplo: **perfil_bi** — Homem · Bi · Niterói/RJ.

Para casal: **casal_rio** — Casal · Rio de Janeiro/RJ. **Não** renderizar uma orientação única como se descrevesse ambos os integrantes.

| Campo | Política no cabeçalho compacto | Regra |
| --- | --- | --- |
| Apelido | **Essencial** | Um nome público validado; nunca nome civil, e-mail ou UID como fallback. Sem apelido válido, usar estado neutro. |
| Avatar público | Opcional | Usar URL pública autorizada e normalizada. Sem foto ou erro: inicial do apelido; não tentar resgatar mídia privada. |
| Tipo de perfil | Condicional | Exibir rótulo curto somente quando o código público corresponder ao catálogo; não adivinhar pelo avatar ou comportamento. Distinguir perfis individuais e casais. |
| Orientação sexual | Condicional e sensível | Somente se o usuário tiver declarado valor **presente na projeção pública autorizada**, em perfil individual e do conjunto `heterossexual → Hétero`, `bissexual → Bi`, `homossexual → Homo`, `pansexual → Pan`. Sem valor, ocultar **sem placeholder**. Não derivar de identidade, preferências, conexões ou mídia. |
| Localização | Condicional | No máximo município/UF publicados, com UF válida. Não exibir coordenadas, endereço, distância precisa ou localização ao vivo no cabeçalho. |
| Selo oficial ou profissional | **Fora do contrato mínimo** | Se houver autoridade backend atual e comprovação apropriada, exibir badge **contextual** separado. Não equivaler conta profissional a conta oficial; nunca derivar profissão de fotos, gênero ou interesses. |
| Contexto da superfície | Separado | Horário de mensagem, prévia de conteúdo, contador e ações pertencem à superfície; usar slots/contexto do componente sem ampliar o contrato de identidade. |

A ordem é **avatar → apelido → tipo de perfil · orientação (se autorizada) · município/UF**. Em telas pequenas, preservar o apelido e permitir quebra/eliminação discreta de metadados; não comprimir controles nem criar scroll horizontal. Densidades atuais: `compact`, `standard`, `comfortable`. Botões e links preservam alvo de toque de pelo menos 44 px, foco visível, contraste e nome acessível. Evitar um badge para cada atributo.

Não incluir na linha canônica: idade exata, data de nascimento, identidade civil, documentos/KYC, comprovação de maioridade, orientação presumida, preferências sexuais, práticas, contatos, fotos de conteúdo, busca por parceiro, planos pagos, status financeiro, distância exata ou localização em tempo real. Se algum campo adicional for legitimamente necessário para decisões de descoberta, tratá-lo em **seção específica do perfil**, com consentimento/autoridade e testes de acesso próprios, jamais por conveniência de layout.

**Maioridade é verificação de autorização e segurança no backend**, não inferência de texto ou um selo `18+` baseado em autodeclaração.

## Fonte e limites de confiança

1. Usar exclusivamente consultas públicas autorizadas, como `FirestoreUserQueryService.getPublicUserById$` via `UserDiscoveryQueryService.getProfilesByUids$` e fronteira backend de `public_profiles`; **não** consultar `/users` em superfícies alheias.
2. Ao identificar o proprietário de galeria, comparar `profile.uid` com o UID da rota antes de construir a identidade. Troca de rota exige `switchMap` para cancelar resultados anteriores. Falha, bloqueio, revogação ou ausência de perfil não autorizam fallback para mídia ou documento privado.
3. Transportar somente a *allowlist* de campos necessários para `normalizePublicUserIdentity`. A função sanitiza texto, UF, URL e rótulos; **não substitui as regras do servidor**. A projeção pública precisa ser autorizada antes de o cliente receber orientação ou mídia.
4. Não promover UID interno a `profileId`. `profileId` público somente quando fornecido e válido na origem pública; navegação contextual de galerias mantém UID de rota exclusivamente para consulta/roteamento autorizado.
5. Não inferir informação de parceiros de casal a partir de orientação agregada. Se orientação individual vier a ser apresentada, exigir contrato explícito por integrante, privacidade e testes próprios.
6. Compartilhamento de estado e falhas: fluxos `Observable` com `switchMap`, `shareReplay({ bufferSize: 1, refCount: true })`; encaminhar falhas de mídia para o tratamento central existente, sem detalhes pessoais em logs.
7. Acessibilidade: avatar decorativo com `alt=""`/ocultação apropriada, fallback visual, apelido legível, sequência de metadados exposta uma única vez ao leitor de tela e nenhuma distinção apenas por cor.

## Matriz de superfícies auditadas no código

| Superfície | Situação em 29/10/2026 | Decisão |
| --- | --- | --- |
| Lista de chat direto | Usa `app-public-user-identity` | Preservar componente, densidade e contexto de mensagem. |
| Publicações de comunidades | Usa `app-public-user-identity` | Preservar variante compacta/padrão conforme visualização. |
| Galeria pública de fotos | Usa `app-public-user-identity` com leitura autorizada por UID | Referência visual observada no desktop; manter layout de galeria separado. |
| Galeria pública de vídeos | **Migrada nesta revisão** para `app-public-user-identity` com consulta pública por UID | Mesma ordem e normalização de campos da galeria de fotos; estado neutro durante leitura. |
| Visualizador de foto | **Migrado nesta revisão** para `app-public-user-identity` em densidade compacta | Autor vem somente do item público ativo; mantém badge oficial, recomendação, link de perfil e navegação entre donos diferentes. |
| Visualizador de vídeo | **Migrado nesta revisão** para `app-public-user-identity` em densidade compacta | Reaproveita `video.owner` público e mantém badges, link, reprodução, foco e controles existentes. |
| Perfil visitado | **Normalizado nesta revisão:** H1 semântico, foto grande, ações e metadados pelo `app-public-user-identity` sem avatar/nome duplicados | Identidade, orientação e município/UF usam o mesmo catálogo; idade exata retirada do hero; distância aproximada e descrição ficam em Sobre. |
| Meu perfil | Área de gestão própria | Separar dados privados para edição do que é efetivamente projetado em superfícies públicas. |
| Cards de descoberta | `PublicProfilesListComponent`/`UserCardComponent` e `SuggestedProfilesComponent` usam identidade canônica sem duplicidade | `identityCode` do backend precede gênero legado; idade exata e orientação repetida não aparecem. Sugestões foram migradas para leitura pública autorizada (`getSuggestedProfiles`) e somente campos de apresentação permitidos são encaminhados. Outras superfícies de Explore requerem auditoria própria. |
| Prévia rápida de perfil | `PublicUserPreviewPopoverComponent` reutiliza o componente de identidade, com presença, distância aproximada, bio e destaques consentidos em contexto separado | Retirados idade exata e texto redundante de orientação da prévia; dados sensíveis desconhecidos não geram rótulos. |
| Explore social — momentos e sugestões | `SocialExplorePageComponent` usa identidade canônica nos status temporários e perfis do estado vazio | Status transporta só nickname/avatar do resumo autorizado, sem inferir tipo ou orientação. Sugestões reutilizam `identityCode`, orientação apenas se autorizada e município/UF. |
| Explore — publicação de comunidade | `ExploreCommunityContentCardComponent` reutiliza identidade do autor público normalizada | O autor já vem de `CommunityExploreContentItem.post.author`; não consulta perfil privado nem cria vínculo de navegação não autorizado. |

## Testes e aceitação

- Testes de normalização verificam os quatro rótulos, ausência e desconhecidos, casal e segurança de URL/UF.
- Testes de galerias verificam UID correto, troca de proprietário, campo opcional e ausência de inferência do casal; layouts verificam reutilização do componente.
- Testes dos visualizadores verificam a identidade do item ativo, o caso de casal e a navegação para o proprietário; a cobertura do código não substitui inspeção visual real em celular.
- Testes do perfil visitado verificam H1, catálogo canônico, orientação de casal, cidade/UF e ausência de idade exata. Testes do mapper/adaptador/card de descoberta cobrem prioridade de `identityCode`, proibição de aliases etários e remoção de metadados duplicados.
- Testes de sugestões certificam que a fonte é `public_profiles` (via `FirestoreQueryService.getSuggestedProfiles`), não consulta direta a `users`; a allowlist exclui email, assinatura e idade; a UI mantém orientação de casal não inferida.
- Testes do Explore verificam autor de comunidade, status temporário e sugestões renderizados com componente canônico, sem extrapolar dados de casais. Prévia rápida não transporta nem mostra idade e orientação em duplicidade.
- O boundary `ui:section-hierarchy-boundary:check` foi atualizado para **exigir** o componente canônico no card sugerido e **proibir** o selo de idade/indicação financeira antigos; o gate não deve exigir atributos removidos por política de privacidade.
- CI deve concluir **Quality Gate, Media E2E e Video Reconciliation** no último commit; commits intermediários podem falhar enquanto todos os arquivos não foram integrados.
- Validação manual **ainda necessária** em mobile real e desktop: telas estreitas, apelidos longos, sem avatar, sem orientação, casal, bloqueio bilateral, visitante autenticado/não autorizado, alternância rápida entre perfis, fontes pequenas/grandes, contraste e leitor de tela. Testar navegação entre perfil, galeria, viewer e retorno, sem vazamento de mídia.

## Próxima etapa delimitada

Os visualizadores de fotos e vídeos compartilham `PublicUserIdentityComponent` em modo compacto, inclusive nas variantes mistas, sem consulta a `/users`. O perfil visitado conserva H1/hero próprios e usa o componente canônico somente para metadados (sem repetir avatar/nome). O card compartilhado de descoberta usa a identidade canônica uma única vez, sem idade exata ou orientação em linha adicional. **Próxima etapa:** validar em desktop/mobile (inclusive orientação paisagem), acessibilidade, nomes longos, bloqueio bilateral e ausência de informações privadas nas projeções autorizadas. A auditoria visual desta revisão é de código e testes, não de dispositivo real. A query legada `FirestoreQueryService.getProfilesByOrientationAndLocation` continua existindo por compatibilidade, mas não é mais utilizada por `SuggestionService` e deve ser removida após auditar outros consumidores. Não ampliar o cabeçalho com interesses, disponibilidade, profissão ou inferências.
