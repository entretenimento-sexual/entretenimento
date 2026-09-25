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
//
// Este arquivo é o kernel mínimo compartilhado entre superfícies sociais.
// Diferenças de copy/rotas específicas ficam em adapters de produto; componentes
// não devem espalhar comparações literais de kind para decidir capacidades.
// -----------------------------------------------------------------------------

import { ROOM_COMPATIBILITY_SURFACE } from './room-compatibility.policy';

export const ACTIVE_SOCIAL_SPACE_KINDS = ['community', 'venue'] as const;
export type ActiveSocialSpaceKind = typeof ACTIVE_SOCIAL_SPACE_KINDS[number];
export type SocialSpaceKind = ActiveSocialSpaceKind | 'room';

export interface SocialSpaceCapabilities {
  readonly publicLocation: boolean;
  readonly topics: boolean;
  readonly memberDirectory: boolean;
  readonly memberSearch: boolean;
  readonly rules: boolean;
  readonly managedLifecycle: boolean;
  readonly capacityManagement: boolean;
  readonly settingsManagement: boolean;
  readonly ownershipManagement: boolean;
  readonly contentModeration: boolean;
  readonly auditTimeline: boolean;
  readonly highlights: boolean;
  readonly feedComposer: boolean;
  readonly membershipProfileVisibility: boolean;
  readonly interestDiscovery: boolean;
  readonly personalMembershipHub: boolean;
  readonly contextRail: boolean;
}


export interface SocialSpaceDefinition {
  readonly kind: SocialSpaceKind;
  readonly label: string;
  readonly pluralLabel: string;
  readonly description: string;
  readonly primaryAction: string;
  readonly navigationRoute: string;
  readonly capabilities: Readonly<SocialSpaceCapabilities>;
}

const COMMUNITY_CAPABILITIES: Readonly<SocialSpaceCapabilities> = Object.freeze({
  publicLocation: false,
  topics: true,
  memberDirectory: true,
  memberSearch: true,
  rules: true,
  managedLifecycle: true,
  capacityManagement: true,
  settingsManagement: true,
  ownershipManagement: true,
  contentModeration: true,
  auditTimeline: true,
  highlights: true,
  feedComposer: true,
  membershipProfileVisibility: true,
  interestDiscovery: true,
  personalMembershipHub: true,
  contextRail: true,
});

const VENUE_CAPABILITIES: Readonly<SocialSpaceCapabilities> = Object.freeze({
  publicLocation: true,
  topics: false,
  memberDirectory: false,
  memberSearch: false,
  rules: false,
  managedLifecycle: false,
  capacityManagement: false,
  settingsManagement: false,
  ownershipManagement: false,
  contentModeration: false,
  auditTimeline: false,
  highlights: false,
  feedComposer: false,
  membershipProfileVisibility: false,
  interestDiscovery: false,
  personalMembershipHub: false,
  contextRail: false,
});

const LEGACY_ROOM_CAPABILITIES: Readonly<SocialSpaceCapabilities> = Object.freeze({
  publicLocation: false,
  topics: false,
  memberDirectory: false,
  memberSearch: false,
  rules: false,
  managedLifecycle: false,
  capacityManagement: false,
  settingsManagement: false,
  ownershipManagement: false,
  contentModeration: false,
  auditTimeline: false,
  highlights: false,
  feedComposer: false,
  membershipProfileVisibility: false,
  interestDiscovery: false,
  personalMembershipHub: false,
  contextRail: false,
});

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
    capabilities: VENUE_CAPABILITIES,
  }),
  community: Object.freeze({
    kind: 'community',
    label: 'Comunidade',
    pluralLabel: 'Comunidades',
    description:
      'Grupo coletivo persistente com membros, regras, mural, moderação e recursos de interação próprios.',
    primaryAction: 'Ver a Comunidade',
    navigationRoute: '/dashboard/comunidades',
    capabilities: COMMUNITY_CAPABILITIES,
  }),
  room: Object.freeze({
    kind: 'room',
    label: 'Sala antiga',
    pluralLabel: 'Salas antigas',
    description:
      'Registro legado mantido somente para compatibilidade e encerramento seguro. Novas interações coletivas pertencem a Comunidades.',
    primaryAction: 'Ver histórico',
    navigationRoute: ROOM_COMPATIBILITY_SURFACE.canonicalRoute,
    capabilities: LEGACY_ROOM_CAPABILITIES,
  }),
});

export function getSocialSpaceDefinition(
  kind: SocialSpaceKind
): SocialSpaceDefinition {
  return SOCIAL_SPACE_DEFINITIONS[kind];
}

export function normalizeActiveSocialSpaceKind(
  value: unknown
): ActiveSocialSpaceKind {
  return value === 'venue' ? 'venue' : 'community';
}

