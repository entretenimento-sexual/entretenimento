// src/app/core/domain/social-space.definition.ts
// -----------------------------------------------------------------------------
// DEFINIÇÕES CANÔNICAS DOS ESPAÇOS SOCIAIS
// -----------------------------------------------------------------------------
//
// Local
// - é um lugar físico ou estabelecimento real;
// - pode ter conteúdo, seguidores, eventos e Comunidade oficial relacionada;
// - não é uma Comunidade, embora possa reutilizar infraestrutura interna.
//
// Comunidade
// - é o domínio canônico para grupos coletivos persistentes;
// - possui membros, regras, mural, moderação, descoberta e lifecycle;
// - futuras conversas coletivas devem ser capacidades subordinadas à Comunidade,
//   sem membership/roles/social graph paralelos.
//
// Sala
// - é um conceito LEGADO preservado exclusivamente para compatibilidade;
// - não recebe criação, convite, aceite, descoberta ou evolução funcional;
// - registros antigos podem ser consultados/encerrados durante a migração.
//
// `room` permanece no tipo por compatibilidade de código/rotas antigas. Removê-lo
// agora quebraria consumidores persistidos antes da etapa final de migração.
// -----------------------------------------------------------------------------

export type SocialSpaceKind = 'venue' | 'community' | 'room';

export interface SocialSpaceDefinition {
  readonly kind: SocialSpaceKind;
  readonly label: string;
  readonly pluralLabel: string;
  readonly description: string;
  readonly primaryAction: string;
  readonly navigationRoute: string;
}

export const SOCIAL_SPACE_DEFINITIONS: Readonly<
  Record<SocialSpaceKind, SocialSpaceDefinition>
> = Object.freeze({
  venue: Object.freeze({
    kind: 'venue',
    label: 'Local',
    pluralLabel: 'Locais',
    description:
      'Lugar físico ou estabelecimento real. Pode publicar novidades, fotos e eventos e ter uma Comunidade oficial relacionada.',
    primaryAction: 'Ver o Local',
    navigationRoute: '/dashboard/locais',
  }),
  community: Object.freeze({
    kind: 'community',
    label: 'Comunidade',
    pluralLabel: 'Comunidades',
    description:
      'Grupo coletivo persistente com membros, regras, mural, moderação e recursos de interação próprios.',
    primaryAction: 'Ver a Comunidade',
    navigationRoute: '/dashboard/comunidades',
  }),
  room: Object.freeze({
    kind: 'room',
    label: 'Sala antiga',
    pluralLabel: 'Salas antigas',
    description:
      'Registro legado mantido somente para compatibilidade e encerramento seguro. Novas interações coletivas pertencem a Comunidades.',
    primaryAction: 'Ver histórico',
    navigationRoute: '/chat/rooms',
  }),
});

export function getSocialSpaceDefinition(
  kind: SocialSpaceKind
): SocialSpaceDefinition {
  return SOCIAL_SPACE_DEFINITIONS[kind];
}
