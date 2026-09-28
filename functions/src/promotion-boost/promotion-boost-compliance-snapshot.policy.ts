// functions/src/promotion-boost/promotion-boost-compliance-snapshot.policy.ts
// -----------------------------------------------------------------------------
// PROMOTION / BOOST COMPLIANCE SNAPSHOT
// -----------------------------------------------------------------------------
// Snapshot backend-only, imutável e auditável para publicidade paga.
//
// Objetivos:
// - preservar informações do anúncio e do anunciante;
// - registrar, sem duplicar autoridade, qual creative/targeting/delivery/payment
//   foi contratado e sob qual regra;
// - manter somente metadados necessários e hashes quando o conteúdo bruto não
//   precisa ser replicado;
// - separar compliance publicitário de ranking orgânico e Official Media Context.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

import type {
  PromotionBoostTargetType,
} from './promotion-boost.policy';

export const PROMOTION_COMPLIANCE_POLICY_VERSION =
  'BR_ADS_2026_09_V1' as const;

export const PROMOTION_COMPLIANCE_REGULATORY_BASIS = Object.freeze([
  'DECRETO_12975_2026_ART_16_K',
  'DECRETO_12975_2026_ART_16_M',
  'DECRETO_12975_2026_ART_16_N',
  'CDC_ART_36_38',
  'LGPD_ART_6',
  'ECA_DIGITAL_ART_22_23',
  'DECRETO_12880_2026_ART_31_33',
  'CONAR_CODIGO_E_GUIA_DIGITAL_2026_09',
] as const);

export type PromotionComplianceTargetingMode =
  | 'contextual_feed'
  | 'contextual_tag'
  | 'contextual_community'
  | 'contextual_venue';

export interface PromotionComplianceCampaignSnapshotInput {
  readonly campaignId: string;
  readonly targetType: PromotionBoostTargetType;
  readonly targetId: string;
  readonly targetOwnerUid: string;
  readonly advertiserUid: string;
  readonly budgetCents: number;
  readonly dailyBudgetCents: number | null;
  readonly currency: 'BRL';
  readonly billingBasis: 'served_placement_cpm';
  readonly rateCpmCentsSnapshot: number;
  readonly billingConfigVersion: number;
  readonly endsAt: number;
  readonly frequencyCapPerViewerPerDay: number;
}

export interface PromotionComplianceAdvertiserSnapshot {
  readonly advertiserUid: string;
  readonly accountPolicyVersion: number;
  readonly accountUpdatedAt: number;
  readonly billingMode: 'postpaid';
  readonly interactionEligible: true;
  readonly authorityVerified: true;
  readonly authorityRole: string;
}

export interface PromotionComplianceCreativeSnapshot {
  readonly targetType: PromotionBoostTargetType;
  readonly targetId: string;
  readonly targetOwnerUid: string;
  readonly creativeVersion: number | null;
  readonly publishedAt: number | null;
  readonly moderationStatus: string;
  readonly visibility: string;
  readonly creativeFingerprintSha256: string;
  readonly rawCreativeRetained: false;
}

export interface PromotionComplianceTargetingSnapshot {
  readonly mode: PromotionComplianceTargetingMode;
  readonly audience: 'verified_adults_only';
  readonly ageEligibilityRequired: true;
  readonly childOrTeenProfilingAllowed: false;
  readonly profileBasedAdvertising: false;
  readonly emotionalAnalysis: false;
  readonly sensitivePersonalDataTargeting: false;
  readonly contextTagIdHash: string | null;
  readonly frequencyCapPerViewerPerDay: number;
}

export interface PromotionComplianceDeliveryPolicySnapshot {
  readonly disclosure: 'Patrocinado';
  readonly advertisingIdentifiable: true;
  readonly paidPlacementSeparatedFromOrganicScore: true;
  readonly selfInteractionExcluded: true;
  readonly adultEligibilityRevalidatedAtDelivery: true;
  readonly frequencyCapEnforcedAtDelivery: true;
  readonly clientReportedEventsFinanciallyNeutral: true;
}

export interface PromotionCompliancePaymentSnapshot {
  readonly billingMode: 'postpaid';
  readonly currency: 'BRL';
  readonly billingBasis: 'served_placement_cpm';
  readonly billingConfigVersion: number;
  readonly rateCpmCents: number;
  readonly budgetCents: number;
  readonly dailyBudgetCents: number | null;
}

export interface PromotionComplianceRetentionSnapshot {
  readonly minimumRule: 'one_calendar_year_after_campaign_end';
  readonly minimumLegalBasis: 'DECRETO_12975_2026_ART_16_M';
  readonly campaignEndsAt: number;
  readonly retainUntil: number;
  readonly privacyMinimized: true;
  readonly legalHoldEligible: true;
  readonly automaticDeletionBeforeRetainUntil: false;
}

export interface PromotionComplianceSnapshot {
  readonly snapshotId: string;
  readonly policyVersion: typeof PROMOTION_COMPLIANCE_POLICY_VERSION;
  readonly capturedAt: number;
  readonly campaignId: string;
  readonly regulatoryBasis:
    typeof PROMOTION_COMPLIANCE_REGULATORY_BASIS;
  readonly advertiser: PromotionComplianceAdvertiserSnapshot;
  readonly creative: PromotionComplianceCreativeSnapshot;
  readonly targeting: PromotionComplianceTargetingSnapshot;
  readonly delivery: PromotionComplianceDeliveryPolicySnapshot;
  readonly payment: PromotionCompliancePaymentSnapshot;
  readonly retention: PromotionComplianceRetentionSnapshot;
}

export interface PromotionComplianceDeliveryEvidence {
  readonly policyVersion: typeof PROMOTION_COMPLIANCE_POLICY_VERSION;
  readonly snapshotId: string;
  readonly campaignId: string;
  readonly placementId: string;
  readonly deliveredAt: number;
  readonly disclosure: 'Patrocinado';
  readonly viewerHash: string;
  readonly adultEligibilityRevalidated: true;
  readonly profileBasedAdvertisingUsed: false;
  readonly emotionalAnalysisUsed: false;
  readonly selfInteractionExcluded: true;
  readonly frequencyCapDay: string;
  readonly frequencyCapDeliveredCount: number;
  readonly billedMilliCents: number;
  readonly currency: 'BRL';
  readonly billingBasis: 'served_placement_cpm';
  readonly retainUntil: number;
}

const SAFE_ID = /^[A-Za-z0-9:_-]{1,128}$/;
const HEX_SHA256 = /^[a-f0-9]{64}$/;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function cleanId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID.test(normalized) ? normalized : null;
}

function finitePositive(value: unknown): number | null {
  const normalized = Math.trunc(Number(value));
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
}

function nonNegative(value: unknown): number | null {
  const normalized = Math.trunc(Number(value));
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : null;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)])
    );
  }

  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    return value;
  }

  return String(value ?? '');
}

function sha256(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');
}

export function promotionComplianceRetainUntil(
  campaignEndsAt: number
): number | null {
  const normalized = finitePositive(campaignEndsAt);
  if (!normalized) return null;

  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) return null;

  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.getTime();
}

export function promotionComplianceContextTagHash(
  value: unknown
): string | null {
  const normalized = cleanId(value);
  return normalized ? sha256(normalized) : null;
}

export function buildPromotionComplianceCreativeSnapshot(input: {
  readonly targetType: PromotionBoostTargetType;
  readonly targetId: string;
  readonly targetOwnerUid: string;
  readonly rawCreative: unknown;
}): Readonly<PromotionComplianceCreativeSnapshot> | null {
  const targetId = cleanId(input.targetId);
  const targetOwnerUid = cleanId(input.targetOwnerUid);
  const source = asRecord(input.rawCreative);
  const creativeVersion =
    finitePositive(source['assetVersion'])
    ?? finitePositive(source['updatedAt'])
    ?? finitePositive(source['publishedAt']);
  const publishedAt = finitePositive(source['publishedAt']);
  const moderationStatus = String(
    source['moderationStatus'] ?? source['moderationState'] ?? ''
  ).trim();
  const visibility = String(source['visibility'] ?? '').trim();

  if (!targetId || !targetOwnerUid || !moderationStatus || !visibility) {
    return null;
  }

  const fingerprintSource = {
    targetType: input.targetType,
    targetId,
    targetOwnerUid,
    creativeVersion,
    publishedAt,
    moderationStatus,
    visibility,
    title: source['title'] ?? null,
    caption: source['caption'] ?? null,
    description: source['description'] ?? null,
    alt: source['alt'] ?? null,
    source: source['source'] ?? null,
  };

  return Object.freeze({
    targetType: input.targetType,
    targetId,
    targetOwnerUid,
    creativeVersion,
    publishedAt,
    moderationStatus,
    visibility,
    creativeFingerprintSha256: sha256(fingerprintSource),
    rawCreativeRetained: false,
  });
}

export function buildPromotionComplianceSnapshot(input: {
  readonly campaign: Readonly<PromotionComplianceCampaignSnapshotInput>;
  readonly advertiserAccount: {
    readonly policyVersion: number;
    readonly updatedAt: number;
    readonly billingMode: 'postpaid';
  };
  readonly advertiserAuthorityRole: string;
  readonly creative: Readonly<PromotionComplianceCreativeSnapshot>;
  readonly targetingMode: PromotionComplianceTargetingMode;
  readonly contextTagId?: string | null;
  readonly capturedAt: number;
}): Readonly<PromotionComplianceSnapshot> | null {
  const campaignId = cleanId(input.campaign.campaignId);
  const advertiserUid = cleanId(input.campaign.advertiserUid);
  const capturedAt = finitePositive(input.capturedAt);
  const advertiserPolicyVersion = finitePositive(
    input.advertiserAccount.policyVersion
  );
  const advertiserUpdatedAt = finitePositive(
    input.advertiserAccount.updatedAt
  );
  const retainUntil = promotionComplianceRetainUntil(input.campaign.endsAt);
  const authorityRole = String(input.advertiserAuthorityRole ?? '').trim();

  if (
    !campaignId
    || !advertiserUid
    || !capturedAt
    || !advertiserPolicyVersion
    || !advertiserUpdatedAt
    || input.advertiserAccount.billingMode !== 'postpaid'
    || !authorityRole
    || !retainUntil
    || input.creative.targetType !== input.campaign.targetType
    || input.creative.targetId !== input.campaign.targetId
    || input.creative.targetOwnerUid !== input.campaign.targetOwnerUid
  ) {
    return null;
  }

  const snapshotBody = {
    policyVersion: PROMOTION_COMPLIANCE_POLICY_VERSION,
    capturedAt,
    campaignId,
    regulatoryBasis: PROMOTION_COMPLIANCE_REGULATORY_BASIS,
    advertiser: {
      advertiserUid,
      accountPolicyVersion: advertiserPolicyVersion,
      accountUpdatedAt: advertiserUpdatedAt,
      billingMode: 'postpaid' as const,
      interactionEligible: true as const,
      authorityVerified: true as const,
      authorityRole,
    },
    creative: input.creative,
    targeting: {
      mode: input.targetingMode,
      audience: 'verified_adults_only' as const,
      ageEligibilityRequired: true as const,
      childOrTeenProfilingAllowed: false as const,
      profileBasedAdvertising: false as const,
      emotionalAnalysis: false as const,
      sensitivePersonalDataTargeting: false as const,
      contextTagIdHash: promotionComplianceContextTagHash(
        input.contextTagId ?? null
      ),
      frequencyCapPerViewerPerDay:
        input.campaign.frequencyCapPerViewerPerDay,
    },
    delivery: {
      disclosure: 'Patrocinado' as const,
      advertisingIdentifiable: true as const,
      paidPlacementSeparatedFromOrganicScore: true as const,
      selfInteractionExcluded: true as const,
      adultEligibilityRevalidatedAtDelivery: true as const,
      frequencyCapEnforcedAtDelivery: true as const,
      clientReportedEventsFinanciallyNeutral: true as const,
    },
    payment: {
      billingMode: 'postpaid' as const,
      currency: input.campaign.currency,
      billingBasis: input.campaign.billingBasis,
      billingConfigVersion: input.campaign.billingConfigVersion,
      rateCpmCents: input.campaign.rateCpmCentsSnapshot,
      budgetCents: input.campaign.budgetCents,
      dailyBudgetCents: input.campaign.dailyBudgetCents,
    },
    retention: {
      minimumRule: 'one_calendar_year_after_campaign_end' as const,
      minimumLegalBasis: 'DECRETO_12975_2026_ART_16_M' as const,
      campaignEndsAt: input.campaign.endsAt,
      retainUntil,
      privacyMinimized: true as const,
      legalHoldEligible: true as const,
      automaticDeletionBeforeRetainUntil: false as const,
    },
  };

  return Object.freeze({
    snapshotId: sha256(snapshotBody),
    ...snapshotBody,
  });
}

export function buildPromotionComplianceDeliveryEvidence(input: {
  readonly snapshotId: string;
  readonly campaign: Readonly<PromotionComplianceCampaignSnapshotInput>;
  readonly placementId: string;
  readonly deliveredAt: number;
  readonly viewerHash: string;
  readonly frequencyCapDay: string;
  readonly frequencyCapDeliveredCount: number;
  readonly billedMilliCents: number;
}): Readonly<PromotionComplianceDeliveryEvidence> | null {
  const snapshotId = String(input.snapshotId ?? '').trim().toLowerCase();
  const placementId = cleanId(input.placementId);
  const deliveredAt = finitePositive(input.deliveredAt);
  const viewerHash = String(input.viewerHash ?? '').trim().toLowerCase();
  const frequencyCapDeliveredCount = nonNegative(
    input.frequencyCapDeliveredCount
  );
  const billedMilliCents = nonNegative(input.billedMilliCents);
  const retainUntil = promotionComplianceRetainUntil(input.campaign.endsAt);

  if (
    !HEX_SHA256.test(snapshotId)
    || !placementId
    || !deliveredAt
    || !/^[a-f0-9]{40}$/.test(viewerHash)
    || !/^\d{4}-\d{2}-\d{2}$/.test(input.frequencyCapDay)
    || frequencyCapDeliveredCount === null
    || billedMilliCents === null
    || !retainUntil
  ) {
    return null;
  }

  return Object.freeze({
    policyVersion: PROMOTION_COMPLIANCE_POLICY_VERSION,
    snapshotId,
    campaignId: input.campaign.campaignId,
    placementId,
    deliveredAt,
    disclosure: 'Patrocinado',
    viewerHash,
    adultEligibilityRevalidated: true,
    profileBasedAdvertisingUsed: false,
    emotionalAnalysisUsed: false,
    selfInteractionExcluded: true,
    frequencyCapDay: input.frequencyCapDay,
    frequencyCapDeliveredCount,
    billedMilliCents,
    currency: input.campaign.currency,
    billingBasis: input.campaign.billingBasis,
    retainUntil,
  });
}
