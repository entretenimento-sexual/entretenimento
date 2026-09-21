// functions/src/community-boost/community-boost.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY BOOST DOMAIN POLICY
// -----------------------------------------------------------------------------
// Domínio patrocinado independente do ranking orgânico.
//
// Invariantes:
// - v2/v3 nunca recebem peso, bônus ou sinal financeiro;
// - orçamento limita faturamento, não compra discoveryScore;
// - pacing escolhe somente entre campanhas patrocinadas elegíveis;
// - frequency cap é operacional e efêmero por viewer/campanha/dia;
// - métricas comportamentais persistidas são somente agregadas.
// -----------------------------------------------------------------------------

export const COMMUNITY_BOOST_POLICY_VERSION = 1;
export const COMMUNITY_BOOST_DISCLOSURE = 'Patrocinado' as const;
export const COMMUNITY_BOOST_CURRENCY = 'BRL' as const;
export const COMMUNITY_BOOST_BILLING_BASIS =
  'served_placement_cpm' as const;
export const COMMUNITY_BOOST_MAX_CAMPAIGN_DAYS = 90;
export const COMMUNITY_BOOST_MAX_FREQUENCY_CAP_PER_DAY = 10;
export const COMMUNITY_BOOST_CANDIDATE_SCAN_LIMIT = 24;
export const COMMUNITY_BOOST_MAX_SELECTION_ATTEMPTS = 6;
export const COMMUNITY_BOOST_MIN_ORGANIC_CARDS_FOR_PLACEMENT = 4;
export const COMMUNITY_BOOST_PLACEMENT_TTL_MS = 15 * 60 * 1_000;
export const COMMUNITY_BOOST_FREQUENCY_CAP_TTL_MS = 3 * 24 * 60 * 60 * 1_000;

export type CommunityBoostSourceType = 'community' | 'venue';
export type CommunityBoostCampaignStatus =
  | 'active'
  | 'paused'
  | 'completed'
  | 'canceled';

export interface CommunityBoostBillingConfig {
  readonly active: boolean;
  readonly version: number;
  readonly currency: typeof COMMUNITY_BOOST_CURRENCY;
  readonly rateCpmCents: number;
  readonly minBudgetCents: number;
  readonly maxBudgetCents: number;
  readonly updatedAt: number;
  readonly updatedBy: string;
}

export interface CommunityBoostAdvertiserAccount {
  readonly policyVersion: typeof COMMUNITY_BOOST_POLICY_VERSION;
  readonly advertiserUid: string;
  readonly active: boolean;
  readonly billingMode: 'postpaid';
  readonly currency: typeof COMMUNITY_BOOST_CURRENCY;
  readonly maxCampaignBudgetCents: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly updatedBy: string;
}

export interface CommunityBoostCampaign {
  readonly policyVersion: typeof COMMUNITY_BOOST_POLICY_VERSION;
  readonly campaignId: string;
  readonly communityId: string;
  readonly ownerUid: string;
  readonly targetSourceType: CommunityBoostSourceType;
  readonly targetTagId: string | null;
  readonly status: CommunityBoostCampaignStatus;
  readonly budgetCents: number;
  readonly dailyBudgetCents: number | null;
  readonly spentMilliCents: number;
  readonly dailySpendDay: string | null;
  readonly dailySpentMilliCents: number;
  readonly currency: typeof COMMUNITY_BOOST_CURRENCY;
  readonly billingBasis: typeof COMMUNITY_BOOST_BILLING_BASIS;
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
}

export interface CommunityBoostRotationCandidate {
  readonly campaignId: string;
  readonly deliveredToday: number;
  readonly frequencyCapPerViewerPerDay: number;
  readonly pacingDebtMilliCents: number;
  readonly rateCpmCentsSnapshot: number;
  readonly stableRotationKey: string;
}

export interface CommunityBoostPacingDecision {
  readonly eligible: boolean;
  readonly budgetRemainingMilliCents: number;
  readonly dailyBudgetRemainingMilliCents: number | null;
  readonly targetSpendMilliCents: number;
  readonly pacingDebtMilliCents: number;
  readonly reason:
    | null
    | 'inactive'
    | 'outside_schedule'
    | 'budget_exhausted'
    | 'daily_budget_exhausted'
    | 'ahead_of_pacing';
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

export function normalizeCommunityBoostBillingConfig(
  raw: unknown
): Readonly<CommunityBoostBillingConfig> | null {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const version = positiveInteger(source['version']);
  const rateCpmCents = positiveInteger(source['rateCpmCents']);
  const minBudgetCents = positiveInteger(source['minBudgetCents']);
  const maxBudgetCents = positiveInteger(source['maxBudgetCents']);
  const updatedAt = finiteEpoch(source['updatedAt']);
  const updatedBy = cleanId(source['updatedBy']);

  if (
    source['active'] !== true
    || source['currency'] !== COMMUNITY_BOOST_CURRENCY
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
    currency: COMMUNITY_BOOST_CURRENCY,
    rateCpmCents,
    minBudgetCents,
    maxBudgetCents,
    updatedAt,
    updatedBy,
  });
}

export function normalizeCommunityBoostAdvertiserAccount(
  raw: unknown,
  expectedAdvertiserUid?: string
): Readonly<CommunityBoostAdvertiserAccount> | null {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const advertiserUid = cleanId(source['advertiserUid']);
  const expectedUid = expectedAdvertiserUid === undefined
    ? null
    : cleanId(expectedAdvertiserUid);
  const maxCampaignBudgetCents = positiveInteger(
    source['maxCampaignBudgetCents']
  );
  const createdAt = finiteEpoch(source['createdAt']);
  const updatedAt = finiteEpoch(source['updatedAt']);
  const updatedBy = cleanId(source['updatedBy']);

  if (
    source['policyVersion'] !== COMMUNITY_BOOST_POLICY_VERSION
    || !advertiserUid
    || (expectedAdvertiserUid !== undefined && advertiserUid !== expectedUid)
    || source['active'] !== true
    || source['billingMode'] !== 'postpaid'
    || source['currency'] !== COMMUNITY_BOOST_CURRENCY
    || !maxCampaignBudgetCents
    || !createdAt
    || !updatedAt
    || updatedAt < createdAt
    || !updatedBy
  ) {
    return null;
  }

  return Object.freeze({
    policyVersion: COMMUNITY_BOOST_POLICY_VERSION,
    advertiserUid,
    active: true,
    billingMode: 'postpaid',
    currency: COMMUNITY_BOOST_CURRENCY,
    maxCampaignBudgetCents,
    createdAt,
    updatedAt,
    updatedBy,
  });
}

export function normalizeCommunityBoostSourceType(
  value: unknown
): CommunityBoostSourceType | null {
  return value === 'community' || value === 'venue' ? value : null;
}

export function buildCommunityBoostCampaign(input: {
  readonly campaignId: unknown;
  readonly communityId: unknown;
  readonly ownerUid: unknown;
  readonly targetSourceType: unknown;
  readonly targetTagId?: unknown;
  readonly budgetCents: unknown;
  readonly dailyBudgetCents?: unknown;
  readonly startsAt: unknown;
  readonly endsAt: unknown;
  readonly frequencyCapPerViewerPerDay: unknown;
  readonly billingConfig: Readonly<CommunityBoostBillingConfig>;
  readonly now: number;
}): Readonly<CommunityBoostCampaign> | null {
  const campaignId = cleanId(input.campaignId);
  const communityId = cleanId(input.communityId);
  const ownerUid = cleanId(input.ownerUid);
  const targetSourceType = normalizeCommunityBoostSourceType(
    input.targetSourceType
  );
  const targetTagId = input.targetTagId === null
    || input.targetTagId === undefined
    || String(input.targetTagId).trim() === ''
    ? null
    : cleanId(input.targetTagId);
  const budgetCents = positiveInteger(input.budgetCents);
  const dailyBudgetCents = input.dailyBudgetCents === null
    || input.dailyBudgetCents === undefined
    ? null
    : positiveInteger(input.dailyBudgetCents);
  const startsAt = finiteEpoch(input.startsAt);
  const endsAt = finiteEpoch(input.endsAt);
  const frequencyCapPerViewerPerDay = positiveInteger(
    input.frequencyCapPerViewerPerDay
  );
  const now = finiteEpoch(input.now);

  if (
    !campaignId
    || !communityId
    || !ownerUid
    || !targetSourceType
    || (
      input.targetTagId !== null
      && input.targetTagId !== undefined
      && String(input.targetTagId).trim() !== ''
      && !targetTagId
    )
    || !budgetCents
    || !startsAt
    || !endsAt
    || !frequencyCapPerViewerPerDay
    || frequencyCapPerViewerPerDay
      > COMMUNITY_BOOST_MAX_FREQUENCY_CAP_PER_DAY
    || !now
    || startsAt < now - DAY_MS
    || endsAt <= startsAt
    || endsAt - startsAt > COMMUNITY_BOOST_MAX_CAMPAIGN_DAYS * DAY_MS
    || budgetCents < input.billingConfig.minBudgetCents
    || budgetCents > input.billingConfig.maxBudgetCents
    || (
      dailyBudgetCents !== null
      && dailyBudgetCents > budgetCents
    )
  ) {
    return null;
  }

  return Object.freeze({
    policyVersion: COMMUNITY_BOOST_POLICY_VERSION,
    campaignId,
    communityId,
    ownerUid,
    targetSourceType,
    targetTagId,
    status: 'active',
    budgetCents,
    dailyBudgetCents,
    spentMilliCents: 0,
    dailySpendDay: null,
    dailySpentMilliCents: 0,
    currency: COMMUNITY_BOOST_CURRENCY,
    billingBasis: COMMUNITY_BOOST_BILLING_BASIS,
    rateCpmCentsSnapshot: input.billingConfig.rateCpmCents,
    billingConfigVersion: input.billingConfig.version,
    startsAt,
    endsAt,
    frequencyCapPerViewerPerDay,
    deliveredCount: 0,
    qualifiedExposureCount: 0,
    clickCount: 0,
    createdAt: now,
    updatedAt: now,
  });
}

export function normalizeCommunityBoostCampaign(
  raw: unknown
): Readonly<CommunityBoostCampaign> | null {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const status = source['status'];
  const campaignId = cleanId(source['campaignId']);
  const communityId = cleanId(source['communityId']);
  const ownerUid = cleanId(source['ownerUid']);
  const targetSourceType = normalizeCommunityBoostSourceType(
    source['targetSourceType']
  );
  const rawTargetTagId = source['targetTagId'];
  const targetTagId = rawTargetTagId === null ? null : cleanId(rawTargetTagId);
  const budgetCents = positiveInteger(source['budgetCents']);
  const dailyBudgetCents = source['dailyBudgetCents'] === null
    ? null
    : positiveInteger(source['dailyBudgetCents']);
  const rateCpmCentsSnapshot = positiveInteger(source['rateCpmCentsSnapshot']);
  const billingConfigVersion = positiveInteger(source['billingConfigVersion']);
  const startsAt = finiteEpoch(source['startsAt']);
  const endsAt = finiteEpoch(source['endsAt']);
  const frequencyCapPerViewerPerDay = positiveInteger(
    source['frequencyCapPerViewerPerDay']
  );
  const createdAt = finiteEpoch(source['createdAt']);
  const updatedAt = finiteEpoch(source['updatedAt']);

  if (
    source['policyVersion'] !== COMMUNITY_BOOST_POLICY_VERSION
    || !campaignId
    || !communityId
    || !ownerUid
    || !targetSourceType
    || (rawTargetTagId !== null && !targetTagId)
    || (
      status !== 'active'
      && status !== 'paused'
      && status !== 'completed'
      && status !== 'canceled'
    )
    || !budgetCents
    || (source['dailyBudgetCents'] !== null && !dailyBudgetCents)
    || source['currency'] !== COMMUNITY_BOOST_CURRENCY
    || source['billingBasis'] !== COMMUNITY_BOOST_BILLING_BASIS
    || !rateCpmCentsSnapshot
    || !billingConfigVersion
    || !startsAt
    || !endsAt
    || endsAt <= startsAt
    || !frequencyCapPerViewerPerDay
    || frequencyCapPerViewerPerDay
      > COMMUNITY_BOOST_MAX_FREQUENCY_CAP_PER_DAY
    || !createdAt
    || !updatedAt
  ) {
    return null;
  }

  return Object.freeze({
    policyVersion: COMMUNITY_BOOST_POLICY_VERSION,
    campaignId,
    communityId,
    ownerUid,
    targetSourceType,
    targetTagId,
    status,
    budgetCents,
    dailyBudgetCents,
    spentMilliCents: nonNegativeInteger(source['spentMilliCents']),
    dailySpendDay: typeof source['dailySpendDay'] === 'string'
      ? source['dailySpendDay']
      : null,
    dailySpentMilliCents: nonNegativeInteger(source['dailySpentMilliCents']),
    currency: COMMUNITY_BOOST_CURRENCY,
    billingBasis: COMMUNITY_BOOST_BILLING_BASIS,
    rateCpmCentsSnapshot,
    billingConfigVersion,
    startsAt,
    endsAt,
    frequencyCapPerViewerPerDay,
    deliveredCount: nonNegativeInteger(source['deliveredCount']),
    qualifiedExposureCount: nonNegativeInteger(
      source['qualifiedExposureCount']
    ),
    clickCount: nonNegativeInteger(source['clickCount']),
    createdAt,
    updatedAt,
  });
}

export function resolveCommunityBoostDay(now: number): string {
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

export function evaluateCommunityBoostPacing(input: {
  readonly campaign: Readonly<CommunityBoostCampaign>;
  readonly now: number;
}): Readonly<CommunityBoostPacingDecision> {
  const { campaign } = input;
  const now = finiteEpoch(input.now) ?? Date.now();
  const budgetMilliCents = campaign.budgetCents * 1_000;
  const budgetRemainingMilliCents = Math.max(
    budgetMilliCents - campaign.spentMilliCents,
    0
  );

  if (campaign.status !== 'active') {
    return Object.freeze({
      eligible: false,
      budgetRemainingMilliCents,
      dailyBudgetRemainingMilliCents: null,
      targetSpendMilliCents: 0,
      pacingDebtMilliCents: 0,
      reason: 'inactive',
    });
  }

  if (now < campaign.startsAt || now >= campaign.endsAt) {
    return Object.freeze({
      eligible: false,
      budgetRemainingMilliCents,
      dailyBudgetRemainingMilliCents: null,
      targetSpendMilliCents: 0,
      pacingDebtMilliCents: 0,
      reason: 'outside_schedule',
    });
  }

  if (budgetRemainingMilliCents < campaign.rateCpmCentsSnapshot) {
    return Object.freeze({
      eligible: false,
      budgetRemainingMilliCents,
      dailyBudgetRemainingMilliCents: null,
      targetSpendMilliCents: budgetMilliCents,
      pacingDebtMilliCents: 0,
      reason: 'budget_exhausted',
    });
  }

  const day = resolveCommunityBoostDay(now);
  const dailyBudgetMilliCents = campaign.dailyBudgetCents === null
    ? null
    : campaign.dailyBudgetCents * 1_000;
  const dailySpent = campaign.dailySpendDay === day
    ? campaign.dailySpentMilliCents
    : 0;
  const dailyBudgetRemainingMilliCents = dailyBudgetMilliCents === null
    ? null
    : Math.max(dailyBudgetMilliCents - dailySpent, 0);

  if (
    dailyBudgetRemainingMilliCents !== null
    && dailyBudgetRemainingMilliCents < campaign.rateCpmCentsSnapshot
  ) {
    return Object.freeze({
      eligible: false,
      budgetRemainingMilliCents,
      dailyBudgetRemainingMilliCents,
      targetSpendMilliCents: 0,
      pacingDebtMilliCents: 0,
      reason: 'daily_budget_exhausted',
    });
  }

  const totalDays = Math.max(
    1,
    Math.ceil((campaign.endsAt - campaign.startsAt) / DAY_MS)
  );
  const elapsedDays = Math.min(
    totalDays,
    Math.floor(Math.max(now - campaign.startsAt, 0) / DAY_MS) + 1
  );
  const targetSpendMilliCents = Math.min(
    budgetMilliCents,
    Math.ceil((budgetMilliCents * elapsedDays) / totalDays)
  );
  const pacingDebtMilliCents = Math.max(
    targetSpendMilliCents - campaign.spentMilliCents,
    0
  );

  return Object.freeze({
    eligible: pacingDebtMilliCents >= campaign.rateCpmCentsSnapshot,
    budgetRemainingMilliCents,
    dailyBudgetRemainingMilliCents,
    targetSpendMilliCents,
    pacingDebtMilliCents,
    reason: pacingDebtMilliCents >= campaign.rateCpmCentsSnapshot
      ? null
      : 'ahead_of_pacing',
  });
}

export function orderCommunityBoostRotationCandidates<
  T extends Readonly<CommunityBoostRotationCandidate>
>(
  candidates: readonly T[]
): readonly T[] {
  return [...candidates].sort((left, right) => {
    const leftCap = Math.max(1, left.frequencyCapPerViewerPerDay);
    const rightCap = Math.max(1, right.frequencyCapPerViewerPerDay);
    const frequencyRatioDifference =
      left.deliveredToday * rightCap
      - right.deliveredToday * leftCap;

    if (frequencyRatioDifference !== 0) {
      return frequencyRatioDifference;
    }

    const leftPacingExposureDebt =
      left.pacingDebtMilliCents
      / Math.max(1, left.rateCpmCentsSnapshot);
    const rightPacingExposureDebt =
      right.pacingDebtMilliCents
      / Math.max(1, right.rateCpmCentsSnapshot);

    if (leftPacingExposureDebt !== rightPacingExposureDebt) {
      return rightPacingExposureDebt - leftPacingExposureDebt;
    }

    const stableKeyDifference = left.stableRotationKey.localeCompare(
      right.stableRotationKey
    );
    return stableKeyDifference !== 0
      ? stableKeyDifference
      : left.campaignId.localeCompare(right.campaignId);
  });
}

export function isCommunityBoostTargetEligible(input: {
  readonly campaign: Readonly<CommunityBoostCampaign>;
  readonly sourceType: CommunityBoostSourceType;
  readonly tagId: string | null;
  readonly excludedCommunityIds: ReadonlySet<string>;
}): boolean {
  return input.campaign.targetSourceType === input.sourceType
    && !input.excludedCommunityIds.has(input.campaign.communityId)
    && (
      input.campaign.targetTagId === null
      || input.campaign.targetTagId === input.tagId
    );
}
