// functions/src/community-boost/community-boost-selection.service.ts
// -----------------------------------------------------------------------------
// COMMUNITY BOOST SPONSORED DELIVERY
// -----------------------------------------------------------------------------
// Seleciona no máximo um placement patrocinado por primeira página.
//
// A seleção acontece DEPOIS do ranking orgânico e recebe explicitamente os IDs
// já devolvidos pelo orgânico. Nenhum campo de campanha entra em rankScore,
// discoveryScore, candidate v3, diversidade ou cursor.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

import { FieldValue } from 'firebase-admin/firestore';

import { db } from '../firebaseApp';
import {
  filterCommunityDiscoveryCardForViewer,
  sanitizeCommunityDiscoveryProjection,
  type CommunityPreviewCard,
} from '../community/community-preview.model';
import {
  buildPromotionComplianceDeliveryEvidence,
} from '../promotion-boost/promotion-boost-compliance-snapshot.policy';
import {
  evaluateCommunityBoostCampaignAuthorityInTransaction,
  stopCommunityBoostForAuthorityLossInTransaction,
} from './community-boost-authority.service';
import {
  COMMUNITY_BOOST_CANDIDATE_SCAN_LIMIT,
  COMMUNITY_BOOST_DISCLOSURE,
  COMMUNITY_BOOST_FREQUENCY_CAP_TTL_MS,
  COMMUNITY_BOOST_MAX_SELECTION_ATTEMPTS,
  COMMUNITY_BOOST_PLACEMENT_TTL_MS,
  evaluateCommunityBoostPacing,
  isCommunityBoostTargetEligible,
  normalizeCommunityBoostAdvertiserAccount,
  normalizeCommunityBoostCampaign,
  orderCommunityBoostRotationCandidates,
  resolveCommunityBoostDay,
  type CommunityBoostCampaign,
  type CommunityBoostSourceType,
} from './community-boost.policy';

export interface CommunityBoostSponsoredPlacement {
  readonly placementId: string;
  readonly campaignId: string;
  readonly disclosure: typeof COMMUNITY_BOOST_DISCLOSURE;
  readonly community: CommunityPreviewCard;
}

export interface CommunityBoostSelectionDiagnostics {
  readonly campaignDocumentsFetched: number;
  readonly campaignQueryReadsProxy: number;
  readonly eligibleCandidateCount: number;
  readonly frequencyCapReads: number;
  readonly visibilityReads: number;
  readonly claimAttempts: number;
  readonly claimTransactionReads: number;
  readonly deliveryWrites: number;
}

export interface CommunityBoostSelectionResult {
  readonly placement: CommunityBoostSponsoredPlacement | null;
  readonly diagnostics: CommunityBoostSelectionDiagnostics;
}

interface RankedCampaignCandidate {
  readonly campaign: Readonly<CommunityBoostCampaign>;
  readonly pacingDebtMilliCents: number;
  readonly deliveredToday: number;
  readonly stableRotationKey: string;
}

function viewerHash(uid: string): string {
  return createHash('sha256').update(uid).digest('hex').slice(0, 40);
}

function complianceSnapshotId(raw: unknown): string | null {
  const value = String(raw ?? '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function buildFrequencyCapId(
  campaignId: string,
  uid: string,
  day: string
): string {
  return `${campaignId}:${viewerHash(uid)}:${day}`;
}

function stableRotationKey(input: {
  readonly viewerUid: string;
  readonly day: string;
  readonly sourceType: CommunityBoostSourceType;
  readonly tagId: string | null;
  readonly campaignId: string;
}): string {
  return createHash('sha256')
    .update([
      viewerHash(input.viewerUid),
      input.day,
      input.sourceType,
      input.tagId ?? 'all',
      input.campaignId,
    ].join(':'))
    .digest('hex');
}

function activeCampaignCandidates(
  snapshots: readonly FirebaseFirestore.QueryDocumentSnapshot[],
  input: {
    readonly now: number;
    readonly sourceType: CommunityBoostSourceType;
    readonly tagId: string | null;
    readonly excludedCommunityIds: ReadonlySet<string>;
  }
): readonly RankedCampaignCandidate[] {
  const candidates: RankedCampaignCandidate[] = [];

  for (const snapshot of snapshots) {
    const campaign = normalizeCommunityBoostCampaign(snapshot.data());
    if (!campaign || campaign.campaignId !== snapshot.id) continue;
    if (
      !isCommunityBoostTargetEligible({
        campaign,
        sourceType: input.sourceType,
        tagId: input.tagId,
        excludedCommunityIds: input.excludedCommunityIds,
      })
    ) {
      continue;
    }

    const pacing = evaluateCommunityBoostPacing({
      campaign,
      now: input.now,
    });
    if (!pacing.eligible) continue;

    candidates.push({
      campaign,
      pacingDebtMilliCents: pacing.pacingDebtMilliCents,
      deliveredToday: 0,
      stableRotationKey: campaign.campaignId,
    });
  }

  return candidates
    .sort((left, right) =>
      right.pacingDebtMilliCents - left.pacingDebtMilliCents
      || left.campaign.campaignId.localeCompare(right.campaign.campaignId)
    )
    .slice(0, COMMUNITY_BOOST_MAX_SELECTION_ATTEMPTS);
}

async function rotateCandidatesForViewer(input: {
  readonly candidates: readonly RankedCampaignCandidate[];
  readonly viewerUid: string;
  readonly sourceType: CommunityBoostSourceType;
  readonly tagId: string | null;
  readonly now: number;
}): Promise<readonly RankedCampaignCandidate[]> {
  if (input.candidates.length === 0) return [];

  const day = resolveCommunityBoostDay(input.now);
  const capRefs = input.candidates.map(({ campaign }) =>
    db.collection('community_boost_frequency_caps').doc(
      buildFrequencyCapId(campaign.campaignId, input.viewerUid, day)
    )
  );
  const capSnapshots = await db.getAll(...capRefs);
  const ranked = input.candidates
    .map((candidate, index): RankedCampaignCandidate => {
      const cap = capSnapshots[index]?.exists
        ? capSnapshots[index]?.data() ?? {}
        : {};
      const deliveredToday = cap['day'] === day
        ? Math.max(
          0,
          Math.trunc(Number(cap['deliveredCount']) || 0)
        )
        : 0;

      return {
        ...candidate,
        deliveredToday,
        stableRotationKey: stableRotationKey({
          viewerUid: input.viewerUid,
          day,
          sourceType: input.sourceType,
          tagId: input.tagId,
          campaignId: candidate.campaign.campaignId,
        }),
      };
    })
    .filter(
      ({ campaign, deliveredToday }) =>
        deliveredToday < campaign.frequencyCapPerViewerPerDay
    );

  return orderCommunityBoostRotationCandidates(
    ranked.map((candidate) => ({
      ...candidate,
      campaignId: candidate.campaign.campaignId,
      frequencyCapPerViewerPerDay:
        candidate.campaign.frequencyCapPerViewerPerDay,
      rateCpmCentsSnapshot: candidate.campaign.rateCpmCentsSnapshot,
    }))
  );
}

async function resolveVisibleCandidate(input: {
  readonly viewerUid: string;
  readonly campaign: Readonly<CommunityBoostCampaign>;
}): Promise<CommunityPreviewCard | null> {
  const projectionRef = db
    .collection('community_discovery_index')
    .doc(input.campaign.communityId);
  const membershipRef = db
    .collection('communities')
    .doc(input.campaign.communityId)
    .collection('members')
    .doc(input.viewerUid);
  const [projectionSnapshot, membershipSnapshot] = await Promise.all([
    projectionRef.get(),
    membershipRef.get(),
  ]);

  if (!projectionSnapshot.exists) return null;
  const card = sanitizeCommunityDiscoveryProjection(
    projectionSnapshot.id,
    projectionSnapshot.data()
  );
  if (!card || card.source.type !== input.campaign.targetSourceType) {
    return null;
  }

  const membership = membershipSnapshot.exists
    ? membershipSnapshot.data() ?? {}
    : {};
  const status = membership['status'];

  // Boost é aquisição. Não disputa atenção com espaços em que o viewer já
  // possui vínculo ativo/pendente e respeita bloqueio.
  if (status === 'active' || status === 'pending' || status === 'blocked') {
    return null;
  }

  return filterCommunityDiscoveryCardForViewer(card, membership);
}

async function claimPlacement(input: {
  readonly viewerUid: string;
  readonly campaign: Readonly<CommunityBoostCampaign>;
  readonly card: CommunityPreviewCard;
  readonly now: number;
}): Promise<CommunityBoostSponsoredPlacement | null> {
  const placementRef = db.collection('community_boost_placements').doc();
  const campaignRef = db
    .collection('community_boost_campaigns')
    .doc(input.campaign.campaignId);
  const day = resolveCommunityBoostDay(input.now);
  const capId = buildFrequencyCapId(
    input.campaign.campaignId,
    input.viewerUid,
    day
  );
  const capRef = db.collection('community_boost_frequency_caps').doc(capId);
  const advertiserAccountRef = db
    .collection('community_boost_advertiser_accounts')
    .doc(input.campaign.advertiserUid);
  const metricsRef = campaignRef.collection('metrics_daily').doc(day);
  const billingLedgerRef = campaignRef.collection('billing_ledger').doc(day);
  const activeSlotRef = db
    .collection('community_boost_active_slots')
    .doc(input.campaign.communityId);

  return db.runTransaction(async (transaction) => {
    const [
      campaignSnapshot,
      capSnapshot,
      advertiserAccountSnapshot,
    ] = await Promise.all([
      transaction.get(campaignRef),
      transaction.get(capRef),
      transaction.get(advertiserAccountRef),
    ]);
    const rawCampaign = campaignSnapshot.exists
      ? campaignSnapshot.data() ?? {}
      : {};
    const campaign = campaignSnapshot.exists
      ? normalizeCommunityBoostCampaign(rawCampaign)
      : null;

    if (!campaign) return null;

    const complianceId = complianceSnapshotId(
      rawCampaign['complianceSnapshotId']
    );
    if (!complianceId) {
      transaction.update(campaignRef, {
        status: 'canceled',
        stoppedAt: input.now,
        stoppedReason: 'compliance_snapshot_required',
        updatedAt: input.now,
      });
      transaction.delete(activeSlotRef);
      transaction.create(db.collection('community_boost_audit').doc(), {
        action: 'community_boost_campaign_stopped',
        campaignId: campaign.campaignId,
        communityId: campaign.communityId,
        advertiserUid: campaign.advertiserUid,
        actorUid: 'system',
        previousStatus: campaign.status,
        nextStatus: 'canceled',
        reason: 'compliance_snapshot_required',
        ledgerOwnershipTransferred: false,
        createdAt: input.now,
      });
      return null;
    }

    const advertiserAccount = normalizeCommunityBoostAdvertiserAccount(
      advertiserAccountSnapshot.exists
        ? advertiserAccountSnapshot.data()
        : null,
      campaign.advertiserUid
    );
    if (
      !advertiserAccount
      || campaign.budgetCents > advertiserAccount.maxCampaignBudgetCents
    ) {
      return null;
    }

    const authorityDecision =
      await evaluateCommunityBoostCampaignAuthorityInTransaction(
        transaction,
        campaign
      );
    if (!authorityDecision.allowed) {
      await stopCommunityBoostForAuthorityLossInTransaction({
        transaction,
        campaign,
        decision: authorityDecision,
        now: input.now,
      });
      return null;
    }

    const pacing = evaluateCommunityBoostPacing({
      campaign,
      now: input.now,
    });
    if (!pacing.eligible) return null;

    const cap = capSnapshot.exists ? capSnapshot.data() ?? {} : {};
    const deliveredToday = cap['day'] === day
      ? Math.max(
        0,
        Math.trunc(Number(cap['deliveredCount']) || 0)
      )
      : 0;
    if (deliveredToday >= campaign.frequencyCapPerViewerPerDay) {
      return null;
    }

    // Faturamento é server-authoritative: o placement só nasce se a cobrança
    // unitária couber no budget total e no budget diário. O navegador nunca
    // concede autoridade financeira por evento de visibilidade.
    const chargeMilliCents = campaign.rateCpmCentsSnapshot;
    const totalBudgetMilliCents = campaign.budgetCents * 1_000;
    const totalRemainingMilliCents = Math.max(
      totalBudgetMilliCents - campaign.spentMilliCents,
      0
    );
    const dailySpentMilliCents = campaign.dailySpendDay === day
      ? campaign.dailySpentMilliCents
      : 0;
    const dailyBudgetMilliCents = campaign.dailyBudgetCents === null
      ? null
      : campaign.dailyBudgetCents * 1_000;
    const dailyRemainingMilliCents = dailyBudgetMilliCents === null
      ? null
      : Math.max(
        dailyBudgetMilliCents - dailySpentMilliCents,
        0
      );

    if (
      totalRemainingMilliCents < chargeMilliCents
      || (
        dailyRemainingMilliCents !== null
        && dailyRemainingMilliCents < chargeMilliCents
      )
    ) {
      return null;
    }

    const nextSpentMilliCents =
      campaign.spentMilliCents + chargeMilliCents;
    const nextDailySpentMilliCents =
      dailySpentMilliCents + chargeMilliCents;
    const remainingAfterChargeMilliCents = Math.max(
      totalBudgetMilliCents - nextSpentMilliCents,
      0
    );
    const completesCampaign =
      remainingAfterChargeMilliCents < chargeMilliCents;
    const targetOwnerUid = campaign.communityOwnerUidSnapshot;
    const hashedViewer = viewerHash(input.viewerUid);

    if (!targetOwnerUid) {
      return null;
    }

    const deliveryCompliance = buildPromotionComplianceDeliveryEvidence({
      snapshotId: complianceId,
      campaign: {
        campaignId: campaign.campaignId,
        targetType: 'community',
        targetId: campaign.communityId,
        targetOwnerUid,
        advertiserUid: campaign.advertiserUid,
        budgetCents: campaign.budgetCents,
        dailyBudgetCents: campaign.dailyBudgetCents,
        currency: campaign.currency,
        billingBasis: campaign.billingBasis,
        rateCpmCentsSnapshot: campaign.rateCpmCentsSnapshot,
        billingConfigVersion: campaign.billingConfigVersion,
        endsAt: campaign.endsAt,
        frequencyCapPerViewerPerDay:
          campaign.frequencyCapPerViewerPerDay,
      },
      placementId: placementRef.id,
      deliveredAt: input.now,
      viewerHash: hashedViewer,
      frequencyCapDay: day,
      frequencyCapDeliveredCount: deliveredToday + 1,
      billedMilliCents: chargeMilliCents,
    });

    if (!deliveryCompliance) {
      return null;
    }

    transaction.set(capRef, {
      campaignId: campaign.campaignId,
      viewerHash: hashedViewer,
      day,
      deliveredCount: deliveredToday + 1,
      expiresAt: input.now + COMMUNITY_BOOST_FREQUENCY_CAP_TTL_MS,
      updatedAt: input.now,
    }, { merge: false });

    transaction.create(placementRef, {
      placementId: placementRef.id,
      campaignId: campaign.campaignId,
      communityId: campaign.communityId,
      advertiserUid: campaign.advertiserUid,
      targetOwnerUid: campaign.communityOwnerUidSnapshot,
      viewerHash: viewerHash(input.viewerUid),
      sourceType: campaign.targetSourceType,
      disclosure: COMMUNITY_BOOST_DISCLOSURE,
      status: 'delivered',
      deliveredAt: input.now,
      expiresAt: input.now + COMMUNITY_BOOST_PLACEMENT_TTL_MS,
      qualifiedExposureRecordedAt: null,
      clickRecordedAt: null,
      billedMilliCents: chargeMilliCents,
      billingReason: 'served_placement',
      complianceSnapshotId: complianceId,
      compliance: deliveryCompliance,
      createdAt: input.now,
      updatedAt: input.now,
    });

    transaction.update(campaignRef, {
      deliveredCount: FieldValue.increment(1),
      spentMilliCents: nextSpentMilliCents,
      dailySpendDay: day,
      dailySpentMilliCents: nextDailySpentMilliCents,
      ...(completesCampaign ? { status: 'completed' } : {}),
      updatedAt: input.now,
    });
    transaction.set(metricsRef, {
      day,
      deliveredCount: FieldValue.increment(1),
      qualifiedExposureCount: FieldValue.increment(0),
      clickCount: FieldValue.increment(0),
      billedMilliCents: FieldValue.increment(chargeMilliCents),
      updatedAt: input.now,
    }, { merge: true });
    transaction.set(billingLedgerRef, {
      day,
      advertiserUid: campaign.advertiserUid,
      communityOwnerUidSnapshot:
        campaign.communityOwnerUidSnapshot,
      authoritySnapshotVersion:
        campaign.authoritySnapshotVersion,
      ledgerOwnershipTransferred: false,
      currency: campaign.currency,
      billingBasis: campaign.billingBasis,
      billingConfigVersion: campaign.billingConfigVersion,
      rateCpmCentsSnapshot: campaign.rateCpmCentsSnapshot,
      complianceSnapshotId: complianceId,
      compliancePolicyVersion: deliveryCompliance.policyVersion,
      complianceRetentionReviewAt: deliveryCompliance.retainUntil,
      billablePlacements: FieldValue.increment(1),
      amountMilliCents: FieldValue.increment(chargeMilliCents),
      updatedAt: input.now,
    }, { merge: true });

    transaction.create(
      db.collection('promotion_boost_billing_events').doc(
        `community:${placementRef.id}`
      ),
      {
        billingEventId: `community:${placementRef.id}`,
        placementId: placementRef.id,
        campaignId: campaign.campaignId,
        targetType: 'community',
        targetId: campaign.communityId,
        targetOwnerUid: campaign.communityOwnerUidSnapshot,
        advertiserUid: campaign.advertiserUid,
        ledgerOwnershipTransferred: false,
        currency: campaign.currency,
        billingBasis: campaign.billingBasis,
        billingConfigVersion: campaign.billingConfigVersion,
        rateCpmCentsSnapshot: campaign.rateCpmCentsSnapshot,
        amountMilliCents: chargeMilliCents,
        reason: 'served_placement',
        complianceSnapshotId: complianceId,
        compliance: deliveryCompliance,
        complianceRetentionReviewAt: deliveryCompliance.retainUntil,
        createdAt: input.now,
      }
    );

    return Object.freeze({
      placementId: placementRef.id,
      campaignId: campaign.campaignId,
      disclosure: COMMUNITY_BOOST_DISCLOSURE,
      community: input.card,
    });
  });
}

export async function selectCommunityBoostSponsoredPlacementWithDiagnostics(input: {
  readonly viewerUid: string;
  readonly sourceType: CommunityBoostSourceType;
  readonly tagId: string | null;
  readonly excludedCommunityIds: readonly string[];
  readonly now: number;
}): Promise<CommunityBoostSelectionResult> {
  const viewerUid = String(input.viewerUid ?? '').trim();
  if (!viewerUid) {
    return {
      placement: null,
      diagnostics: {
        campaignDocumentsFetched: 0,
        campaignQueryReadsProxy: 0,
        eligibleCandidateCount: 0,
        frequencyCapReads: 0,
        visibilityReads: 0,
        claimAttempts: 0,
        claimTransactionReads: 0,
        deliveryWrites: 0,
      },
    };
  }

  const campaignSnapshot = await db
    .collection('community_boost_campaigns')
    .where('status', '==', 'active')
    .where('targetSourceType', '==', input.sourceType)
    .where('startsAt', '<=', input.now)
    .orderBy('startsAt', 'desc')
    .limit(COMMUNITY_BOOST_CANDIDATE_SCAN_LIMIT)
    .get();

  const candidates = activeCampaignCandidates(
    campaignSnapshot.docs,
    {
      now: input.now,
      sourceType: input.sourceType,
      tagId: input.tagId,
      excludedCommunityIds: new Set(input.excludedCommunityIds),
    }
  ).filter(({ campaign }) =>
    campaign.advertiserUid !== viewerUid
    && campaign.communityOwnerUidSnapshot !== viewerUid
  );

  const rotatedCandidates = await rotateCandidatesForViewer({
    candidates,
    viewerUid,
    sourceType: input.sourceType,
    tagId: input.tagId,
    now: input.now,
  });
  let visibilityReads = 0;
  let claimAttempts = 0;

  for (const candidate of rotatedCandidates) {
    visibilityReads += 2;
    const card = await resolveVisibleCandidate({
      viewerUid,
      campaign: candidate.campaign,
    });
    if (!card) continue;

    claimAttempts += 1;
    const placement = await claimPlacement({
      viewerUid,
      campaign: candidate.campaign,
      card,
      now: input.now,
    });
    if (placement) {
      return {
        placement,
        diagnostics: {
          campaignDocumentsFetched: campaignSnapshot.size,
          campaignQueryReadsProxy: Math.max(1, campaignSnapshot.size),
          eligibleCandidateCount: candidates.length,
          frequencyCapReads: candidates.length,
          visibilityReads,
          claimAttempts,
          claimTransactionReads: claimAttempts * 7,
          deliveryWrites: 5,
        },
      };
    }
  }

  return {
    placement: null,
    diagnostics: {
      campaignDocumentsFetched: campaignSnapshot.size,
      campaignQueryReadsProxy: Math.max(1, campaignSnapshot.size),
      eligibleCandidateCount: candidates.length,
      frequencyCapReads: candidates.length,
      visibilityReads,
      claimAttempts,
      claimTransactionReads: claimAttempts * 7,
      deliveryWrites: 0,
    },
  };
}

export async function selectCommunityBoostSponsoredPlacement(input: {
  readonly viewerUid: string;
  readonly sourceType: CommunityBoostSourceType;
  readonly tagId: string | null;
  readonly excludedCommunityIds: readonly string[];
  readonly now: number;
}): Promise<CommunityBoostSponsoredPlacement | null> {
  const result = await selectCommunityBoostSponsoredPlacementWithDiagnostics(
    input
  );
  return result.placement;
}
