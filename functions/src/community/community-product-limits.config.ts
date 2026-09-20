// functions/src/community/community-product-limits.config.ts
// -----------------------------------------------------------------------------
// COMMUNITY PRODUCT LIMITS
// -----------------------------------------------------------------------------
// Valores, metas e estratégia de produto ajustáveis para lançamento/operação.
// Este é o ponto canônico para capacidades, quotas funcionais e limites
// comerciais que podem mudar por estratégia sem alterar invariantes de domínio.
//
// Não misturar aqui limites técnicos de paginação, batch, query, retry ou
// retenção operacional, nem controles de antiabuso, autorização, segurança ou
// invariantes de lifecycle/transação.
// -----------------------------------------------------------------------------

const SELECTABLE_MEMBER_LIMITS = [25, 50, 100, 250, 500, 1_000] as const;

const MEMBER_LIMIT_BY_SPONSOR_ROLE = Object.freeze({
  free: 0,
  basic: 100,
  premium: 250,
  vip: 500,
  official: 1_000,
  official_space: 1_000,
  admin: 1_000,
} as const);

const OWNED_PERSONAL_COMMUNITIES_BY_SPONSOR_ROLE = Object.freeze({
  free: 0,
  basic: 1,
  premium: 3,
  vip: 5,
  admin: null,
} as const);

const finitePersonalCommunityLimits = Object.values(
  OWNED_PERSONAL_COMMUNITIES_BY_SPONSOR_ROLE
).filter((value) => typeof value === 'number');

const CONTENT_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1_000;

export const COMMUNITY_PRODUCT_LIMITS = Object.freeze({
  defaultMemberLimit: SELECTABLE_MEMBER_LIMITS[0],
  selectableMemberLimits: SELECTABLE_MEMBER_LIMITS,
  officialCommunityMemberLimit: MEMBER_LIMIT_BY_SPONSOR_ROLE.official,
  // Alias compatível com o fluxo legado de Local Oficial.
  officialSpaceMemberLimit: MEMBER_LIMIT_BY_SPONSOR_ROLE.official_space,
  maxPersonalCommunitiesPerOwner: Math.max(...finitePersonalCommunityLimits),
  maxOfficialSpacesPerGrant: 20,
  minimumPersonalCommunityCreationRole: 'basic',
  publicSubscriptionRoleOrder: Object.freeze([
    'basic',
    'premium',
    'vip',
  ] as const),
  memberLimitBySponsorRole: MEMBER_LIMIT_BY_SPONSOR_ROLE,
  ownedPersonalCommunitiesBySponsorRole:
    OWNED_PERSONAL_COMMUNITIES_BY_SPONSOR_ROLE,
  contentWriteQuotas: Object.freeze({
    feedPosts: Object.freeze({
      windowMs: CONTENT_QUOTA_WINDOW_MS,
      defaultLimit: 24,
      minLimit: 1,
      maxLimit: 200,
    }),
    topicCreations: Object.freeze({
      windowMs: CONTENT_QUOTA_WINDOW_MS,
      defaultLimit: 12,
      minLimit: 1,
      maxLimit: 100,
    }),
    topicReplies: Object.freeze({
      windowMs: CONTENT_QUOTA_WINDOW_MS,
      defaultLimit: 120,
      minLimit: 1,
      maxLimit: 1_000,
    }),
  }),
} as const);
