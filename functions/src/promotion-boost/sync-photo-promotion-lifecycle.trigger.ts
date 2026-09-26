// functions/src/promotion-boost/sync-photo-promotion-lifecycle.trigger.ts
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import {
  normalizeCommunityBoostAdvertiserAccount,
} from '../community-boost/community-boost.policy';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  isPromotionBoostAdvertiserInteractionEligible,
} from './promotion-boost-advertiser-eligibility';
import {
  advertiserInteractionFieldsChanged,
  isPhotoPromotionPublicationEligible,
  photoPublicationEligibilityChanged,
} from './photo-promotion-target.policy';
import { normalizePromotionBoostCampaign } from './promotion-boost.policy';

async function cancelOpenPhotoPromotion(input: {
  ownerUid: string;
  photoId: string;
  reason: string;
  now: number;
}): Promise<void> {
  const slotRef = db.collection('promotion_boost_active_slots').doc(
    `photo:${input.ownerUid}:${input.photoId}`
  );

  await db.runTransaction(async (transaction) => {
    const slotSnapshot = await transaction.get(slotRef);
    if (!slotSnapshot.exists) return;

    const campaignId = String(
      slotSnapshot.data()?.['campaignId'] ?? ''
    ).trim();
    if (!campaignId) {
      transaction.delete(slotRef);
      return;
    }

    const campaignRef = db
      .collection('promotion_boost_campaigns')
      .doc(campaignId);
    const campaignSnapshot = await transaction.get(campaignRef);
    const campaign = campaignSnapshot.exists
      ? normalizePromotionBoostCampaign(campaignSnapshot.data())
      : null;

    if (
      !campaign
      || campaign.targetType !== 'photo'
      || campaign.targetOwnerUid !== input.ownerUid
      || campaign.targetId !== input.photoId
    ) {
      transaction.delete(slotRef);
      return;
    }

    if (campaign.status !== 'active' && campaign.status !== 'paused') {
      transaction.delete(slotRef);
      return;
    }

    transaction.update(campaignRef, {
      status: 'canceled',
      stoppedAt: input.now,
      stoppedReason: input.reason,
      updatedAt: input.now,
    });
    transaction.delete(slotRef);
    transaction.create(db.collection('promotion_boost_audit').doc(), {
      action: 'photo_promotion_campaign_stopped_by_target_lifecycle',
      campaignId,
      targetType: 'photo',
      ownerUid: input.ownerUid,
      photoId: input.photoId,
      advertiserUid: campaign.advertiserUid,
      previousStatus: campaign.status,
      nextStatus: 'canceled',
      reason: input.reason,
      ledgerOwnershipTransferred: false,
      actorUid: 'system',
      createdAt: input.now,
    });
  });
}

async function cancelPhotoPromotionSlots(
  query: FirebaseFirestore.Query,
  reason: string,
  now: number
): Promise<void> {
  let hasMore = true;

  while (hasMore) {
    const slots = await query.limit(100).get();

    for (const slot of slots.docs) {
      const ownerUid = String(slot.data()?.['ownerUid'] ?? '').trim();
      const photoId = String(slot.data()?.['photoId'] ?? '').trim();

      if (!ownerUid || !photoId) {
        await slot.ref.delete();
        continue;
      }

      await cancelOpenPhotoPromotion({
        ownerUid,
        photoId,
        reason,
        now,
      });
    }

    hasMore = slots.size === 100;
  }
}

async function cancelOwnerPhotoPromotions(
  ownerUid: string,
  reason: string,
  now: number
): Promise<void> {
  const query = db
    .collection('promotion_boost_active_slots')
    .where('targetType', '==', 'photo')
    .where('ownerUid', '==', ownerUid);

  await cancelPhotoPromotionSlots(query, reason, now);
}

async function cancelAdvertiserPhotoPromotions(
  advertiserUid: string,
  reason: string,
  now: number
): Promise<void> {
  const query = db
    .collection('promotion_boost_active_slots')
    .where('targetType', '==', 'photo')
    .where('advertiserUid', '==', advertiserUid);

  await cancelPhotoPromotionSlots(query, reason, now);
}

async function reconcileUserPromotionEligibility(
  userUid: string,
  reason: string,
  now: number
): Promise<void> {
  if (!userUid) return;

  const [userSnapshot, ageEligibilitySnapshot] = await Promise.all([
    db.collection('users').doc(userUid).get(),
    db.collection('age_eligibility_records').doc(userUid).get(),
  ]);

  if (
    isPromotionBoostAdvertiserInteractionEligible({
      rawUser: userSnapshot.exists ? userSnapshot.data() : null,
      rawAgeEligibility: ageEligibilitySnapshot.exists
        ? ageEligibilitySnapshot.data()
        : null,
      advertiserUid: userUid,
    })
  ) {
    return;
  }

  await Promise.all([
    cancelAdvertiserPhotoPromotions(userUid, reason, now),
    cancelOwnerPhotoPromotions(userUid, reason, now),
  ]);
}

export const syncPhotoPromotionFromPublication = onDocumentWritten(
  {
    document: 'users/{ownerUid}/photo_publications/{photoId}',
    region: FUNCTIONS_REGION,
    retry: true,
  },
  async (event) => {
    const before = event.data?.before.exists
      ? event.data.before.data() ?? null
      : null;
    const after = event.data?.after.exists
      ? event.data.after.data() ?? null
      : null;

    if (
      event.data?.after.exists
      && !photoPublicationEligibilityChanged(before, after)
    ) {
      return;
    }
    if (isPhotoPromotionPublicationEligible(after)) return;

    await cancelOpenPhotoPromotion({
      ownerUid: String(event.params.ownerUid ?? '').trim(),
      photoId: String(event.params.photoId ?? '').trim(),
      reason: after ? 'photo_publication_ineligible' : 'photo_unpublished',
      now: Date.now(),
    });
  }
);

export const syncPhotoPromotionFromAdvertiserAccount = onDocumentWritten(
  {
    document: 'community_boost_advertiser_accounts/{advertiserUid}',
    region: FUNCTIONS_REGION,
    retry: true,
  },
  async (event) => {
    const advertiserUid = String(
      event.params.userUid ?? ''
    ).trim();
    if (!advertiserUid) return;

    const after = event.data?.after.exists
      ? event.data.after.data() ?? null
      : null;
    const advertiser = normalizeCommunityBoostAdvertiserAccount(
      after,
      advertiserUid
    );

    if (advertiser) return;

    await cancelAdvertiserPhotoPromotions(
      advertiserUid,
      'advertiser_account_ineligible',
      Date.now()
    );
  }
);


export const syncPhotoPromotionFromUserLifecycle = onDocumentWritten(
  {
    document: 'users/{userUid}',
    region: FUNCTIONS_REGION,
    retry: true,
  },
  async (event) => {
    const before = event.data?.before.exists
      ? event.data.before.data() ?? null
      : null;
    const after = event.data?.after.exists
      ? event.data.after.data() ?? null
      : null;

    if (
      event.data?.after.exists
      && !advertiserInteractionFieldsChanged(before, after)
    ) {
      return;
    }

    await reconcileUserPromotionEligibility(
      String(event.params.userUid ?? '').trim(),
      'advertiser_interaction_ineligible',
      Date.now()
    );
  }
);

export const syncPhotoPromotionFromAgeEligibility =
  onDocumentWritten(
    {
      document: 'age_eligibility_records/{userUid}',
      region: FUNCTIONS_REGION,
      retry: true,
    },
    async (event) => {
      await reconcileUserPromotionEligibility(
        String(event.params.userUid ?? '').trim(),
        'advertiser_age_ineligible',
        Date.now()
      );
    }
  );
