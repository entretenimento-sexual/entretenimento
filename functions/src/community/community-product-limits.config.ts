// functions/src/community/community-product-limits.config.ts
// -----------------------------------------------------------------------------
// COMMUNITY PRODUCT LIMITS
// -----------------------------------------------------------------------------
// Valores e estratégia comerciais ajustáveis para lançamento. Não misturar
// aqui limites técnicos de paginação, batch, query, retry ou retenção
// operacional, nem invariantes de segurança/lifecycle.
// -----------------------------------------------------------------------------

export const COMMUNITY_PRODUCT_LIMITS = Object.freeze({
  defaultMemberLimit: 25,
  selectableMemberLimits: [25, 50, 100, 250, 500, 1_000] as const,
  officialSpaceMemberLimit: 1_000,
  maxPersonalCommunitiesPerOwner: 5,
  minimumPersonalCommunityCreationRole: 'basic',
  publicSubscriptionRoleOrder: Object.freeze([
    'basic',
    'premium',
    'vip',
  ] as const),
  memberLimitBySponsorRole: Object.freeze({
    free: 0,
    basic: 100,
    premium: 250,
    vip: 500,
    official_space: 1_000,
    admin: 1_000,
  }),
  ownedPersonalCommunitiesBySponsorRole: Object.freeze({
    free: 0,
    basic: 1,
    premium: 3,
    vip: 5,
    admin: null,
  }),
} as const);
