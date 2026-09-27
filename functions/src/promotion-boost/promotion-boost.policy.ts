// functions/src/promotion-boost/promotion-boost.policy.ts
// -----------------------------------------------------------------------------
// PROMOTION / BOOST CORE POLICY
// -----------------------------------------------------------------------------
// Núcleo patrocinado reutilizável. Pagamento compra placement identificado;
// nunca score orgânico. Configuração comercial e elegibilidade do anunciante
// entram somente pela fronteira canônica de Promotion/Boost; compatibilidade
// com storage legado fica isolada fora desta policy.
// -----------------------------------------------------------------------------

export const PROMOTION_BOOST_POLICY_VERSION = 1 as const;
export const PROMOTION_BOOST_DISCLOSURE = 'Patrocinado' as const;
export const PROMOTION_BOOST_CURRENCY = 'BRL' as const;
export const PROMOTION_BOOST_BILLING_BASIS =
  'served_placement_cpm' as const;
export const PROMOTION_BOOST_MAX_CAMPAIGN_DAYS = 90;
export const PROMOTION_BOOST_MAX_FREQUENCY_CAP_PER_DAY = 10;
export const PROMOTION_BOOST_CANDIDATE_SCAN_LIMIT = 24;
export const PROMOTION_BOOST_MAX_SELECTION_ATTEMPTS = 6;
export const PROMOTION_BOOST_PLACEMENT_TTL_MS = 15 * 60 * 1_000;
export const PROMOTION_BOOST_FREQUENCY_CAP_TTL_MS =
  3 * 24 * 60 * 60 * 1_000;

export type PromotionBoostTargetType = 'community' | 'photo' | 'video';

export interface PromotionBoostTargetAvailability {
  readonly targetType: PromotionBoostTargetType;
  readonly contractSupported: true;
  readonly campaignCreationEnabled: boolean;
  readonly placementEnabled: boolean;
  readonly reason:
    | 'enabled'
    | 'observe_only_not_calibrated';
}

export function normalizePromotionBoostTargetType(
  value: unknown
): PromotionBoostTargetType | null {
  return value === 'community' || value === 'photo' || value === 'video'
    ? value
    : null;
}

/**
 * Vídeo já pertence ao contrato genérico de Promotion/Boost, mas monetização
 * paga de vídeo permanece deliberadamente indisponível. A liberação futura
 * exige evidência real + decisão explícita/versionada; nunca acontece só porque
 * o target passou a existir no type union.
 */
export function promotionBoostTargetAvailability(
  targetType: PromotionBoostTargetType
): Readonly<PromotionBoostTargetAvailability> {
  if (targetType === 'video') {
    return Object.freeze({
      targetType,
      contractSupported: true,
      campaignCreationEnabled: false,
      placementEnabled: false,
      reason: 'observe_only_not_calibrated',
    });
  }

  return Object.freeze({
    targetType,
    contractSupported: true,
    campaignCreationEnabled: true,
    placementEnabled: true,
    reason: 'enabled',
  });
}
export type PromotionBoostCampaignStatus =
  | 'active'
  | 'paused'
  | 'completed'
  | 'canceled';

export interface PromotionBoostBillingConfig {
  readonly active: boolean;
  readonly version: number;
  readonly currency: typeof PROMOTION_BOOST_CURRENCY;
  readonly rateCpmCents: number;
  readonly minBudgetCents: number;
  readonly maxBudgetCents: number;
  readonly updatedAt: number;
  readonly updatedBy: string;
}

export type PromotionBoostBillingConfigSnapshot = Readonly<
  Pick<
    PromotionBoostBillingConfig,
    'version' | 'currency' | 'rateCpmCents' | 'minBudgetCents' | 'maxBudgetCents'
  >
>;

export interface PromotionBoostAdvertiserAccount {
  readonly policyVersion: typeof PROMOTION_BOOST_POLICY_VERSION;
  readonly advertiserUid: string;
  readonly active: boolean;
  readonly billingMode: 'postpaid';
  readonly currency: typeof PROMOTION_BOOST_CURRENCY;
  readonly maxCampaignBudgetCents: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly updatedBy: string;
}

export interface PromotionBoostCampaign {
  readonly policyVersion: typeof PROMOTION_BOOST_POLICY_VERSION;
  readonly campaignId: string;
  readonly targetType: PromotionBoostTargetType;
  readonly targetId: string;
  readonly targetOwnerUid: string;
  readonly advertiserUid: string;
  readonly status: PromotionBoostCampaignStatus;
  readonly budgetCents: number;
  readonly dailyBudgetCents: number | null;
  readonly spentMilliCents: number;
  readonly dailySpendDay: string | null;
  readonly dailySpentMilliCents: number;
  readonly currency: typeof PROMOTION_BOOST_CURRENCY;
  readonly billingBasis: typeof PROMOTION_BOOST_BILLING_BASIS;
  readonly rateCpmCentsSnapshot: number;
  readonly billingConfigVersion: number;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly frequencyCapPerViewerPerDay: number;
  readonly deliveredCount: number;
  readonly qualifiedExposureCount: number;
  readonly clickCount: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly stoppedAt: number | null;
  readonly stoppedReason: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1_000;
const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function cleanId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeInteger(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function finiteEpoch(value: unknown): number | null {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function normalizePromotionBoostBillingConfig(
  raw: unknown
): Readonly<PromotionBoostBillingConfig> | null {
  const source =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const version = positiveInteger(source['version']);
  const rateCpmCents = positiveInteger(source['rateCpmCents']);
  const minBudgetCents = positiveInteger(source['minBudgetCents']);
  const maxBudgetCents = positiveInteger(source['maxBudgetCents']);
  const updatedAt = finiteEpoch(source['updatedAt']);
  const updatedBy = cleanId(source['updatedBy']);

  if (
    source['active'] !== true
    || source['currency'] !== PROMOTION_BOOST_CURRENCY
    || !version
    || !rateCpmCents
    || !minBudgetCents
    || !maxBudgetCents
    || minBudgetCents > maxBudgetCents
    || !updatedAt
    || !updatedBy
  ) {
    return null;
  }

  return Object.freeze({
    active: true,
    version,
    currency: PROMOTION_BOOST_CURRENCY,
    rateCpmCents,
    minBudgetCents,
    maxBudgetCents,
    updatedAt,
    updatedBy,
  });
}

export function normalizePromotionBoostAdvertiserAccount(
  raw: unknown,
  expectedAdvertiserUid?: string
): Readonly<PromotionBoostAdvertiserAccount> | null {
  const source =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const advertiserUid = cleanId(source['advertiserUid']);
  const expectedUid =
    expectedAdvertiserUid === undefined
      ? null
      : cleanId(expectedAdvertiserUid);
  const maxCampaignBudgetCents = positiveInteger(
    source['maxCampaignBudgetCents']
  );
  const createdAt = finiteEpoch(source['createdAt']);
  const updatedAt = finiteEpoch(source['updatedAt']);
  const updatedBy = cleanId(source['updatedBy']);

  if (
    source['policyVersion'] !== PROMOTION_BOOST_POLICY_VERSION
    || !advertiserUid
    || (expectedAdvertiserUid !== undefined && advertiserUid !== expectedUid)
    || source['active'] !== true
    || source['billingMode'] !== 'postpaid'
    || source['currency'] !== PROMOTION_BOOST_CURRENCY
    || !maxCampaignBudgetCents
    || !createdAt
    || !updatedAt
    || updatedAt < createdAt
    || !updatedBy
  ) {
    return null;
  }

  return Object.freeze({
    policyVersion: PROMOTION_BOOST_POLICY_VERSION,
    advertiserUid,
    active: true,
    billingMode: 'postpaid',
    currency: PROMOTION_BOOST_CURRENCY,
    maxCampaignBudgetCents,
    createdAt,
    updatedAt,
    updatedBy,
  });
}

export function buildPromotionBoostCampaign(input: {
  readonly campaignId: unknown;
  readonly targetType: unknown;
  readonly targetId: unknown;
  readonly targetOwnerUid: unknown;
  readonly advertiserUid: unknown;
  readonly budgetCents: unknown;
  readonly dailyBudgetCents?: unknown;
  readonly startsAt: unknown;
  readonly endsAt: unknown;
  readonly frequencyCapPerViewerPerDay: unknown;
  readonly billingConfig: Readonly<PromotionBoostBillingConfigSnapshot>;
  readonly now: number;
}): Readonly<PromotionBoostCampaign> | null {
  const campaignId = cleanId(input.campaignId);
  const targetType = normalizePromotionBoostTargetType(input.targetType);
  const targetId = cleanId(input.targetId);
  const targetOwnerUid = cleanId(input.targetOwnerUid);
  const advertiserUid = cleanId(input.advertiserUid);
  const budgetCents = positiveInteger(input.budgetCents);
  const dailyBudgetCents =
    input.dailyBudgetCents === null || input.dailyBudgetCents === undefined
      ? null
      : positiveInteger(input.dailyBudgetCents);
  const startsAt = finiteEpoch(input.startsAt);
  const endsAt = finiteEpoch(input.endsAt);
  const cap = positiveInteger(input.frequencyCapPerViewerPerDay);
  const now = finiteEpoch(input.now);

  if (
    !campaignId
    || !targetType
    || !promotionBoostTargetAvailability(targetType).campaignCreationEnabled
    || !targetId
    || !targetOwnerUid
    || !advertiserUid
    || !budgetCents
    || !startsAt
    || !endsAt
    || !cap
    || cap > PROMOTION_BOOST_MAX_FREQUENCY_CAP_PER_DAY
    || !now
    || startsAt < now - DAY_MS
    || endsAt <= startsAt
    || endsAt - startsAt > PROMOTION_BOOST_MAX_CAMPAIGN_DAYS * DAY_MS
    || budgetCents < input.billingConfig.minBudgetCents
    || budgetCents > input.billingConfig.maxBudgetCents
    || (dailyBudgetCents !== null && dailyBudgetCents > budgetCents)
    || input.billingConfig.currency !== PROMOTION_BOOST_CURRENCY
  ) {
    return null;
  }

  return Object.freeze({
    policyVersion: PROMOTION_BOOST_POLICY_VERSION,
    campaignId,
    targetType,
    targetId,
    targetOwnerUid,
    advertiserUid,
    status: 'active' as const,
    budgetCents,
    dailyBudgetCents,
    spentMilliCents: 0,
    dailySpendDay: null,
    dailySpentMilliCents: 0,
    currency: PROMOTION_BOOST_CURRENCY,
    billingBasis: PROMOTION_BOOST_BILLING_BASIS,
    rateCpmCentsSnapshot: input.billingConfig.rateCpmCents,
    billingConfigVersion: input.billingConfig.version,
    startsAt,
    endsAt,
    frequencyCapPerViewerPerDay: cap,
    deliveredCount: 0,
    qualifiedExposureCount: 0,
    clickCount: 0,
    createdAt: now,
    updatedAt: now,
    stoppedAt: null,
    stoppedReason: null,
  });
}

export function normalizePromotionBoostCampaign(
  raw: unknown
): Readonly<PromotionBoostCampaign> | null {
  const source =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const targetType = normalizePromotionBoostTargetType(source['targetType']);
  const status = source['status'];
  const campaignId = cleanId(source['campaignId']);
  const targetId = cleanId(source['targetId']);
  const targetOwnerUid = cleanId(source['targetOwnerUid']);
  const advertiserUid = cleanId(source['advertiserUid']);
  const budgetCents = positiveInteger(source['budgetCents']);
  const dailyBudgetCents =
    source['dailyBudgetCents'] === null
      ? null
      : positiveInteger(source['dailyBudgetCents']);
  const rateCpmCentsSnapshot = positiveInteger(source['rateCpmCentsSnapshot']);
  const billingConfigVersion = positiveInteger(source['billingConfigVersion']);
  const startsAt = finiteEpoch(source['startsAt']);
  const endsAt = finiteEpoch(source['endsAt']);
  const cap = positiveInteger(source['frequencyCapPerViewerPerDay']);
  const createdAt = finiteEpoch(source['createdAt']);
  const updatedAt = finiteEpoch(source['updatedAt']);
  const stoppedAt =
    source['stoppedAt'] === null || source['stoppedAt'] === undefined
      ? null
      : finiteEpoch(source['stoppedAt']);

  if (
    source['policyVersion'] !== PROMOTION_BOOST_POLICY_VERSION
    || !campaignId
    || !targetType
    || !targetId
    || !targetOwnerUid
    || !advertiserUid
    || (status !== 'active'
      && status !== 'paused'
      && status !== 'completed'
      && status !== 'canceled')
    || !budgetCents
    || (source['dailyBudgetCents'] !== null && !dailyBudgetCents)
    || source['currency'] !== PROMOTION_BOOST_CURRENCY
    || source['billingBasis'] !== PROMOTION_BOOST_BILLING_BASIS
    || !rateCpmCentsSnapshot
    || !billingConfigVersion
    || !startsAt
    || !endsAt
    || endsAt <= startsAt
    || !cap
    || cap > PROMOTION_BOOST_MAX_FREQUENCY_CAP_PER_DAY
    || !createdAt
    || !updatedAt
    || (source['stoppedAt'] !== null
      && source['stoppedAt'] !== undefined
      && !stoppedAt)
  ) {
    return null;
  }

  return Object.freeze({
    policyVersion: PROMOTION_BOOST_POLICY_VERSION,
    campaignId,
    targetType,
    targetId,
    targetOwnerUid,
    advertiserUid,
    status,
    budgetCents,
    dailyBudgetCents,
    spentMilliCents: nonNegativeInteger(source['spentMilliCents']),
    dailySpendDay:
      typeof source['dailySpendDay'] === 'string'
        ? source['dailySpendDay']
        : null,
    dailySpentMilliCents: nonNegativeInteger(source['dailySpentMilliCents']),
    currency: PROMOTION_BOOST_CURRENCY,
    billingBasis: PROMOTION_BOOST_BILLING_BASIS,
    rateCpmCentsSnapshot,
    billingConfigVersion,
    startsAt,
    endsAt,
    frequencyCapPerViewerPerDay: cap,
    deliveredCount: nonNegativeInteger(source['deliveredCount']),
    qualifiedExposureCount: nonNegativeInteger(
      source['qualifiedExposureCount']
    ),
    clickCount: nonNegativeInteger(source['clickCount']),
    createdAt,
    updatedAt,
    stoppedAt,
    stoppedReason:
      source['stoppedReason'] === null || source['stoppedReason'] === undefined
        ? null
        : String(source['stoppedReason']).trim().slice(0, 128) || null,
  });
}

export function resolvePromotionBoostDay(now: number): string {
  const safeNow = finiteEpoch(now) ?? Date.now();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(safeNow));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';

  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function promotionBoostCampaignEligible(
  campaign: Readonly<PromotionBoostCampaign>,
  now: number
): boolean {
  if (!promotionBoostTargetAvailability(campaign.targetType).placementEnabled) {
    return false;
  }
  if (campaign.status !== 'active') return false;
  if (now < campaign.startsAt || now >= campaign.endsAt) return false;

  const charge = campaign.rateCpmCentsSnapshot;
  const remaining = campaign.budgetCents * 1_000 - campaign.spentMilliCents;
  if (remaining < charge) return false;

  if (campaign.dailyBudgetCents !== null) {
    const day = resolvePromotionBoostDay(now);
    const dailySpent =
      campaign.dailySpendDay === day ? campaign.dailySpentMilliCents : 0;
    if (campaign.dailyBudgetCents * 1_000 - dailySpent < charge) return false;
  }

  return true;
}
