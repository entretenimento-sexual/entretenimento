// src/app/core/domain/social-space.definition.ts
// -----------------------------------------------------------------------------
// DEFINIÇÕES CANÔNICAS DOS ESPAÇOS SOCIAIS
// -----------------------------------------------------------------------------
//
// Local
// - é um lugar físico ou estabelecimento real;
// - pode ter conteúdo, seguidores, eventos e salas vinculadas;
// - não é uma comunidade, embora reutilize infraestrutura interna de feed,
//   permissões e moderação.
//
// Comunidade
// - é um grupo permanente de pessoas unidas por interesse, identidade, região
//   ou objetivo;
// - possui membros, regras, mural e moderação;
// - não é uma sala de conversa nem representa um estabelecimento físico.
//
// Sala
// - é um espaço de conversa, público ou privado, temporário ou permanente;
// - pode ser independente ou estar vinculada a um Local ou Comunidade;
// - pertence ao domínio de Conversas e não deve aparecer como Comunidade.
//
// Estas definições são usadas pela interface. Alterações conceituais devem ser
// feitas aqui antes de alterar rótulos isolados em componentes.
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
      'Lugar físico ou estabelecimento real. Pode publicar novidades, fotos e eventos e ter salas de conversa vinculadas.',
    primaryAction: 'Ver o Local',
    navigationRoute: '/dashboard/locais',
  }),
  community: Object.freeze({
    kind: 'community',
    label: 'Comunidade',
    pluralLabel: 'Comunidades',
    description:
      'Grupo permanente de pessoas unidas por um interesse, identidade, região ou objetivo, com membros, regras e mural próprios.',
    primaryAction: 'Ver a Comunidade',
    navigationRoute: '/dashboard/comunidades',
  }),
  room: Object.freeze({
    kind: 'room',
    label: 'Sala',
    pluralLabel: 'Salas',
    description:
      'Espaço de conversa em tempo real, público ou privado, que pode ser independente ou vinculado a um Local ou Comunidade.',
    primaryAction: 'Entrar na Sala',
    navigationRoute: '/chat/rooms',
  }),
});

export function getSocialSpaceDefinition(
  kind: SocialSpaceKind
): SocialSpaceDefinition {
  return SOCIAL_SPACE_DEFINITIONS[kind];
}
