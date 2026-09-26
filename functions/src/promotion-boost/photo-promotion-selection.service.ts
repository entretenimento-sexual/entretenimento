// functions/src/promotion-boost/photo-promotion-selection.service.ts
import { createHash } from 'node:crypto';

import { FieldValue } from 'firebase-admin/firestore';

import { normalizeCommunityBoostAdvertiserAccount } from '../community-boost/community-boost.policy';
import { db } from '../firebaseApp';
import {
  resolveSocialConnectionAccess,
} from '../friendship/application/social-connection-access.policy';
import {
  resolvePublicMediaSignedOwnerExposure,
} from '../media/application/public-media-owner-exposure.service';
import {
  isPromotionBoostAdvertiserInteractionEligible,
} from './promotion-boost-advertiser-eligibility';
import {
  PROMOTION_BOOST_CANDIDATE_SCAN_LIMIT,
  PROMOTION_BOOST_DISCLOSURE,
  PROMOTION_BOOST_FREQUENCY_CAP_TTL_MS,
  PROMOTION_BOOST_MAX_SELECTION_ATTEMPTS,
  PROMOTION_BOOST_PLACEMENT_TTL_MS,
  normalizePromotionBoostCampaign,
  promotionBoostCampaignEligible,
  resolvePromotionBoostDay,
  type PromotionBoostCampaign,
} from './promotion-boost.policy';

export interface PhotoPromotionPlacement {
  readonly placementId: string;
  readonly campaignId: string;
  readonly disclosure: typeof PROMOTION_BOOST_DISCLOSURE;
  readonly photo: Record<string, unknown>;
}

function publicPhotoProjection(
  ownerUid: string,
  photoId: string,
  raw: Record<string, unknown>
): Record<string, unknown> {
  return {
    id: photoId,
    ownerUid,
    mediaType: 'PHOTO',
    assetAccess: 'SIGNED_URL',
    alt: raw['alt'] ?? 'Foto pública',
    caption: raw['caption'] ?? null,
    createdAt: raw['createdAt'] ?? 0,
    publishedAt: raw['publishedAt'] ?? 0,
    assetVersion: raw['assetVersion'] ?? raw['publishedAt'] ?? 0,
    updatedAt: raw['updatedAt'] ?? null,
    visibility: raw['visibility'],
    isCover: raw['isCover'] === true,
    orderIndex: Number(raw['orderIndex'] ?? 0),
    commentsEnabled: raw['commentsEnabled'] === true,
    commentsPolicy: raw['commentsPolicy'] ?? 'OFF',
    commentsCount: Number(raw['commentsCount'] ?? 0),
    reactionsEnabled: raw['reactionsEnabled'] === true,
    reactionsCount: Number(raw['reactionsCount'] ?? 0),
    moderationStatus: raw['moderationStatus'],
    reportsCount: Number(raw['reportsCount'] ?? 0),
    score: Number(raw['score'] ?? 0),
    scoreBreakdown: raw['scoreBreakdown'] ?? null,
    likesCount: Number(raw['likesCount'] ?? 0),
    engagementScore: Number(raw['engagementScore'] ?? 0),
    viewsCount: Number(raw['viewsCount'] ?? 0),
    uniqueViewersCount: Number(raw['uniqueViewersCount'] ?? 0),
    lastViewedAt: raw['lastViewedAt'] ?? null,
    viewScore: Number(raw['viewScore'] ?? 0),
    officialPhoto: raw['officialPhoto'] ?? null,
  };
}

function viewerHash(uid: string): string {
  return createHash('sha256').update(uid).digest('hex').slice(0, 40);
}

function capId(campaignId: string, uid: string, day: string): string {
  return `${campaignId}:${viewerHash(uid)}:${day}`;
}

function stableKey(uid: string, day: string, campaignId: string): string {
  return createHash('sha256')
    .update(`${viewerHash(uid)}:${day}:${campaignId}`)
    .digest('hex');
}

async function photoStillEligible(
  campaign: Readonly<PromotionBoostCampaign>
): Promise<boolean> {
  const [publicationSnapshot, publicPhotoSnapshot] = await Promise.all([
    db.doc(
      `users/${campaign.targetOwnerUid}/photo_publications/${campaign.targetId}`
    ).get(),
    db.doc(
      `public_profiles/${campaign.targetOwnerUid}/public_photos/${campaign.targetId}`
    ).get(),
  ]);

  if (!publicationSnapshot.exists || !publicPhotoSnapshot.exists) return false;

  const publication = publicationSnapshot.data() ?? {};
  const publicPhoto = publicPhotoSnapshot.data() ?? {};

  return (
    publication['ownerUid'] === campaign.targetOwnerUid
    && publication['photoId'] === campaign.targetId
    && publication['isPublished'] === true
    && String(publication['visibility'] ?? '').toUpperCase() === 'PUBLIC'
    && publication['moderationStatus'] === 'APPROVED'
    && publicPhoto['ownerUid'] === campaign.targetOwnerUid
    && publicPhoto['id'] === campaign.targetId
    && String(publicPhoto['visibility'] ?? '').toUpperCase() === 'PUBLIC'
    && publicPhoto['moderationStatus'] === 'APPROVED'
    && publicPhoto['ageEligibilityVerifiedAdult'] === true
  );
}

async function stopIneligibleCampaign(
  campaign: Readonly<PromotionBoostCampaign>,
  now: number,
  reason: string
): Promise<void> {
  const campaignRef = db.collection('promotion_boost_campaigns').doc(campaign.campaignId);
  const slotRef = db.collection('promotion_boost_active_slots').doc(
    `photo:${campaign.targetOwnerUid}:${campaign.targetId}`
  );

  await db.runTransaction(async (transaction) => {
    const latestSnapshot = await transaction.get(campaignRef);
    const latest = latestSnapshot.exists
      ? normalizePromotionBoostCampaign(latestSnapshot.data())
      : null;
    if (!latest || (latest.status !== 'active' && latest.status !== 'paused')) return;

    transaction.update(campaignRef, {
      status: 'canceled',
      stoppedAt: now,
      stoppedReason: reason,
      updatedAt: now,
    });
    transaction.delete(slotRef);
    transaction.create(db.collection('promotion_boost_audit').doc(), {
      action: 'photo_promotion_campaign_stopped',
      campaignId: campaign.campaignId,
      targetType: 'photo',
      ownerUid: campaign.targetOwnerUid,
      photoId: campaign.targetId,
      advertiserUid: campaign.advertiserUid,
      actorUid: 'system',
      previousStatus: latest.status,
      nextStatus: 'canceled',
      reason,
      ledgerOwnershipTransferred: false,
      createdAt: now,
    });
  });
}

async function claimPlacement(input: {
  readonly viewerUid: string;
  readonly campaign: Readonly<PromotionBoostCampaign>;
  readonly now: number;
}): Promise<PhotoPromotionPlacement | null> {
  const day = resolvePromotionBoostDay(input.now);
  const placementRef = db.collection('promotion_boost_placements').doc();
  const campaignRef = db.collection('promotion_boost_campaigns').doc(
    input.campaign.campaignId
  );
  const capRef = db.collection('promotion_boost_frequency_caps').doc(
    capId(input.campaign.campaignId, input.viewerUid, day)
  );
  const advertiserRef = db.collection('community_boost_advertiser_accounts').doc(
    input.campaign.advertiserUid
  );
  const advertiserUserRef = db
    .collection('users')
    .doc(input.campaign.advertiserUid);
  const advertiserAgeEligibilityRef = db
    .collection('age_eligibility_records')
    .doc(input.campaign.advertiserUid);
  const activeSlotRef = db.collection('promotion_boost_active_slots').doc(
    `photo:${input.campaign.targetOwnerUid}:${input.campaign.targetId}`
  );
  const metricsRef = campaignRef.collection('metrics_daily').doc(day);
  const ledgerRef = campaignRef.collection('billing_ledger').doc(day);

  return db.runTransaction(async (transaction) => {
    const [
      campaignSnapshot,
      capSnapshot,
      advertiserSnapshot,
      advertiserUserSnapshot,
      advertiserAgeEligibilitySnapshot,
      publicationSnapshot,
      publicPhotoSnapshot,
    ] = await Promise.all([
      transaction.get(campaignRef),
      transaction.get(capRef),
      transaction.get(advertiserRef),
      transaction.get(advertiserUserRef),
      transaction.get(advertiserAgeEligibilityRef),
      transaction.get(
        db.doc(
          `users/${input.campaign.targetOwnerUid}/photo_publications/${input.campaign.targetId}`
        )
      ),
      transaction.get(
        db.doc(
          `public_profiles/${input.campaign.targetOwnerUid}/public_photos/${input.campaign.targetId}`
        )
      ),
    ]);

    const campaign = campaignSnapshot.exists
      ? normalizePromotionBoostCampaign(campaignSnapshot.data())
      : null;
    if (!campaign || campaign.targetType !== 'photo') return null;
    if (!promotionBoostCampaignEligible(campaign, input.now)) return null;

    const advertiser = normalizeCommunityBoostAdvertiserAccount(
      advertiserSnapshot.exists ? advertiserSnapshot.data() : null,
      campaign.advertiserUid
    );
    if (!advertiser || campaign.budgetCents > advertiser.maxCampaignBudgetCents) {
      return null;
    }

    const advertiserInteractionEligible =
      isPromotionBoostAdvertiserInteractionEligible({
        rawUser: advertiserUserSnapshot.exists
          ? advertiserUserSnapshot.data()
          : null,
        rawAgeEligibility: advertiserAgeEligibilitySnapshot.exists
          ? advertiserAgeEligibilitySnapshot.data()
          : null,
        advertiserUid: campaign.advertiserUid,
      });

    if (!advertiserInteractionEligible) {
      transaction.update(campaignRef, {
        status: 'canceled',
        stoppedAt: input.now,
        stoppedReason: 'advertiser_interaction_ineligible',
        updatedAt: input.now,
      });
      transaction.delete(activeSlotRef);
      transaction.create(db.collection('promotion_boost_audit').doc(), {
        action: 'photo_promotion_campaign_stopped',
        campaignId: campaign.campaignId,
        targetType: 'photo',
        ownerUid: campaign.targetOwnerUid,
        photoId: campaign.targetId,
        advertiserUid: campaign.advertiserUid,
        actorUid: 'system',
        previousStatus: campaign.status,
        nextStatus: 'canceled',
        reason: 'advertiser_interaction_ineligible',
        ledgerOwnershipTransferred: false,
        createdAt: input.now,
      });
      return null;
    }

    const publication = publicationSnapshot.exists
      ? publicationSnapshot.data() ?? {}
      : {};
    const publicPhoto = publicPhotoSnapshot.exists ? publicPhotoSnapshot.data() ?? {} : {};
    const eligible =
      publication['ownerUid'] === campaign.targetOwnerUid
      && publication['photoId'] === campaign.targetId
      && publication['isPublished'] === true
      && String(publication['visibility'] ?? '').toUpperCase() === 'PUBLIC'
      && publication['moderationStatus'] === 'APPROVED'
      && publicPhoto['ownerUid'] === campaign.targetOwnerUid
      && publicPhoto['id'] === campaign.targetId
      && String(publicPhoto['visibility'] ?? '').toUpperCase() === 'PUBLIC'
      && publicPhoto['moderationStatus'] === 'APPROVED'
      && publicPhoto['ageEligibilityVerifiedAdult'] === true;
    if (!eligible) return null;

    const cap = capSnapshot.exists ? capSnapshot.data() ?? {} : {};
    const deliveredToday =
      cap['day'] === day
        ? Math.max(0, Math.trunc(Number(cap['deliveredCount']) || 0))
        : 0;
    if (deliveredToday >= campaign.frequencyCapPerViewerPerDay) return null;

    const chargeMilliCents = campaign.rateCpmCentsSnapshot;
    const totalBudgetMilliCents = campaign.budgetCents * 1_000;
    const totalRemainingMilliCents = Math.max(
      totalBudgetMilliCents - campaign.spentMilliCents,
      0
    );
    const dailySpentMilliCents =
      campaign.dailySpendDay === day ? campaign.dailySpentMilliCents : 0;
    const dailyBudgetMilliCents =
      campaign.dailyBudgetCents === null ? null : campaign.dailyBudgetCents * 1_000;
    const dailyRemainingMilliCents =
      dailyBudgetMilliCents === null
        ? null
        : Math.max(dailyBudgetMilliCents - dailySpentMilliCents, 0);

    if (
      totalRemainingMilliCents < chargeMilliCents
      || (dailyRemainingMilliCents !== null
        && dailyRemainingMilliCents < chargeMilliCents)
    ) {
      return null;
    }

    const nextSpentMilliCents = campaign.spentMilliCents + chargeMilliCents;
    const nextDailySpentMilliCents = dailySpentMilliCents + chargeMilliCents;
    const completesCampaign =
      totalBudgetMilliCents - nextSpentMilliCents < chargeMilliCents;

    transaction.set(capRef, {
      campaignId: campaign.campaignId,
      targetType: 'photo',
      viewerHash: viewerHash(input.viewerUid),
      day,
      deliveredCount: deliveredToday + 1,
      expiresAt: input.now + PROMOTION_BOOST_FREQUENCY_CAP_TTL_MS,
      updatedAt: input.now,
    }, { merge: false });

    transaction.create(placementRef, {
      placementId: placementRef.id,
      campaignId: campaign.campaignId,
      targetType: 'photo',
      ownerUid: campaign.targetOwnerUid,
      photoId: campaign.targetId,
      advertiserUid: campaign.advertiserUid,
      viewerHash: viewerHash(input.viewerUid),
      disclosure: PROMOTION_BOOST_DISCLOSURE,
      status: 'delivered',
      deliveredAt: input.now,
      expiresAt: input.now + PROMOTION_BOOST_PLACEMENT_TTL_MS,
      qualifiedExposureRecordedAt: null,
      clickRecordedAt: null,
      billedMilliCents: chargeMilliCents,
      billingReason: 'served_placement',
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
    if (completesCampaign) {
      transaction.delete(activeSlotRef);
    }

    transaction.set(metricsRef, {
      day,
      deliveredCount: FieldValue.increment(1),
      qualifiedExposureCount: FieldValue.increment(0),
      clickCount: FieldValue.increment(0),
      billedMilliCents: FieldValue.increment(chargeMilliCents),
      updatedAt: input.now,
    }, { merge: true });

    transaction.set(ledgerRef, {
      day,
      targetType: 'photo',
      targetId: campaign.targetId,
      targetOwnerUid: campaign.targetOwnerUid,
      advertiserUid: campaign.advertiserUid,
      ledgerOwnershipTransferred: false,
      currency: campaign.currency,
      billingBasis: campaign.billingBasis,
      billingConfigVersion: campaign.billingConfigVersion,
      rateCpmCentsSnapshot: campaign.rateCpmCentsSnapshot,
      billablePlacements: FieldValue.increment(1),
      amountMilliCents: FieldValue.increment(chargeMilliCents),
      updatedAt: input.now,
    }, { merge: true });

    return Object.freeze({
      placementId: placementRef.id,
      campaignId: campaign.campaignId,
      disclosure: PROMOTION_BOOST_DISCLOSURE,
      photo: publicPhotoProjection(
        campaign.targetOwnerUid,
        campaign.targetId,
        publicPhoto
      ),
    });
  });
}

export async function selectPhotoPromotionPlacement(input: {
  readonly viewerUid: string;
  readonly excludedPhotoKeys: readonly string[];
  readonly now: number;
}): Promise<PhotoPromotionPlacement | null> {
  const snapshot = await db
    .collection('promotion_boost_campaigns')
    .where('targetType', '==', 'photo')
    .where('status', '==', 'active')
    .where('startsAt', '<=', input.now)
    .orderBy('startsAt', 'desc')
    .limit(PROMOTION_BOOST_CANDIDATE_SCAN_LIMIT)
    .get();

  const excluded = new Set(input.excludedPhotoKeys);
  const day = resolvePromotionBoostDay(input.now);
  const candidates = snapshot.docs
    .map((document) => normalizePromotionBoostCampaign(document.data()))
    .filter((campaign): campaign is Readonly<PromotionBoostCampaign> =>
      !!campaign
      && campaign.targetType === 'photo'
      && campaign.advertiserUid !== input.viewerUid
      && campaign.targetOwnerUid !== input.viewerUid
      && promotionBoostCampaignEligible(campaign, input.now)
      && !excluded.has(`${campaign.targetOwnerUid}:${campaign.targetId}`)
    )
    .slice(0, PROMOTION_BOOST_MAX_SELECTION_ATTEMPTS);

  const ownerUids = [
    ...new Set(candidates.map((campaign) => campaign.targetOwnerUid)),
  ];
  const socialAccess = ownerUids.length
    ? await resolveSocialConnectionAccess(input.viewerUid, ownerUids)
    : null;
  const ownerExposure = ownerUids.length && socialAccess
    ? await resolvePublicMediaSignedOwnerExposure(
      ownerUids,
      socialAccess.blockedTargetUids,
      input.now
    )
    : new Map();

  const visibleCandidates = candidates.filter(
    (campaign) =>
      ownerExposure.get(campaign.targetOwnerUid)?.allowed === true
  );

  const capRefs = visibleCandidates.map((campaign) =>
    db.collection('promotion_boost_frequency_caps').doc(
      capId(campaign.campaignId, input.viewerUid, day)
    )
  );
  const capSnapshots = capRefs.length ? await db.getAll(...capRefs) : [];

  const ordered = visibleCandidates
    .map((campaign, index) => {
      const cap = capSnapshots[index]?.exists ? capSnapshots[index]?.data() ?? {} : {};
      const deliveredToday =
        cap['day'] === day
          ? Math.max(0, Math.trunc(Number(cap['deliveredCount']) || 0))
          : 0;
      return {
        campaign,
        deliveredToday,
        key: stableKey(input.viewerUid, day, campaign.campaignId),
      };
    })
    .filter(({ campaign, deliveredToday }) =>
      deliveredToday < campaign.frequencyCapPerViewerPerDay
    )
    .sort((a, b) =>
      a.deliveredToday - b.deliveredToday
      || a.key.localeCompare(b.key)
    );

  for (const { campaign } of ordered) {
    if (!(await photoStillEligible(campaign))) {
      await stopIneligibleCampaign(campaign, input.now, 'photo_target_ineligible');
      continue;
    }
    const placement = await claimPlacement({
      viewerUid: input.viewerUid,
      campaign,
      now: input.now,
    });
    if (placement) return placement;
  }

  return null;
}
