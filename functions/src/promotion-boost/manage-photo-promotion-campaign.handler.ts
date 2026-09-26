// functions/src/promotion-boost/manage-photo-promotion-campaign.handler.ts
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { assertRecentAuthentication } from '../account_lifecycle/_shared';
import { assertInteractionAccessData } from '../account_lifecycle/interaction-access.policy';
import {
  normalizeCommunityBoostAdvertiserAccount,
  normalizeCommunityBoostBillingConfig,
} from '../community-boost/community-boost.policy';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { REQUIRE_CALLABLE_APP_CHECK, assertCallableAppCheck } from '../shared/security/callable-app-check';
import {
  buildPromotionBoostCampaign,
  normalizePromotionBoostCampaign,
} from './promotion-boost.policy';
import {
  isPhotoPromotionTargetEligible,
} from './photo-promotion-target.policy';

type Action = 'create' | 'pause' | 'resume' | 'cancel';

interface Request {
  readonly requestId?: unknown;
  readonly action?: unknown;
  readonly campaignId?: unknown;
  readonly ownerUid?: unknown;
  readonly photoId?: unknown;
  readonly budgetCents?: unknown;
  readonly dailyBudgetCents?: unknown;
  readonly startsAt?: unknown;
  readonly endsAt?: unknown;
  readonly frequencyCapPerViewerPerDay?: unknown;
}

const SAFE_ID = /^[A-Za-z0-9:_-]{1,128}$/;
const SAFE_REQUEST_ID = /^[A-Za-z0-9:_-]{8,128}$/;

function cleanId(value: unknown): string | null {
  const v = String(value ?? '').trim();
  return SAFE_ID.test(v) ? v : null;
}

function cleanRequestId(value: unknown): string | null {
  const v = String(value ?? '').trim();
  return SAFE_REQUEST_ID.test(v) ? v : null;
}

function normalizeAction(value: unknown): Action | null {
  return value === 'create' || value === 'pause' || value === 'resume' || value === 'cancel'
    ? value
    : null;
}

function actorFromAuth(auth: { uid?: string; token?: Record<string, unknown> } | undefined) {
  const uid = cleanId(auth?.uid);
  if (!uid) throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  if (auth?.token?.['email_verified'] !== true) {
    throw new HttpsError('failed-precondition', 'Verifique seu e-mail para continuar.');
  }
  const token = auth.token ?? {};
  const roles = Array.isArray(token['roles']) ? token['roles'] : [];
  return {
    uid,
    admin: token['admin'] === true || token['role'] === 'admin' || roles.includes('admin'),
  };
}

function assertPhotoEligible(
  ownerUid: string,
  photoId: string,
  publication: Record<string, unknown> | null,
  publicPhoto: Record<string, unknown> | null,
  now: number
): void {
  if (
    !isPhotoPromotionTargetEligible({
      ownerUid,
      photoId,
      publication,
      publicPhoto,
      nowMs: now,
    })
  ) {
    throw new HttpsError(
      'failed-precondition',
      'A foto não está elegível para promoção.',
      { reason: 'photo_promotion_target_ineligible' }
    );
  }
}

export const managePhotoPromotionCampaign = onCall<Request>(
  { region: FUNCTIONS_REGION, enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK },
  async (request) => {
    assertCallableAppCheck(request.app);
    const actor = actorFromAuth(request.auth);
    assertRecentAuthentication(request.auth?.token);

    const requestId = cleanRequestId(request.data?.requestId);
    const action = normalizeAction(request.data?.action);
    if (!requestId || !action) {
      throw new HttpsError('invalid-argument', 'Solicitação de promoção inválida.');
    }

    const operationRef = db.collection('promotion_boost_requests').doc(`${actor.uid}:${requestId}`);
    const now = Date.now();

    if (action === 'create') {
      const ownerUid = cleanId(request.data?.ownerUid);
      const photoId = cleanId(request.data?.photoId);
      if (!ownerUid || !photoId) {
        throw new HttpsError('invalid-argument', 'Foto inválida para promoção.');
      }
      if (!actor.admin && ownerUid !== actor.uid) {
        throw new HttpsError('permission-denied', 'Você só pode promover suas próprias fotos.');
      }

      const campaignRef = db.collection('promotion_boost_campaigns').doc();
      const publicationRef = db.doc(`users/${ownerUid}/photo_publications/${photoId}`);
      const publicPhotoRef = db.doc(`public_profiles/${ownerUid}/public_photos/${photoId}`);
      const billingRef = db.collection('community_boost_billing_config').doc('current');
      const advertiserRef = db.collection('community_boost_advertiser_accounts').doc(actor.uid);
      const actorUserRef = db.collection('users').doc(actor.uid);
      const actorAgeRef = db.collection('age_eligibility_records').doc(actor.uid);
      const activeSlotRef = db.collection('promotion_boost_active_slots').doc(`photo:${ownerUid}:${photoId}`);

      return db.runTransaction(async (transaction) => {
        const [
          operationSnapshot,
          publicationSnapshot,
          publicPhotoSnapshot,
          billingSnapshot,
          advertiserSnapshot,
          actorUserSnapshot,
          actorAgeSnapshot,
          activeSlotSnapshot,
        ] = await Promise.all([
          transaction.get(operationRef),
          transaction.get(publicationRef),
          transaction.get(publicPhotoRef),
          transaction.get(billingRef),
          transaction.get(advertiserRef),
          transaction.get(actorUserRef),
          transaction.get(actorAgeRef),
          transaction.get(activeSlotRef),
        ]);

        if (operationSnapshot.exists) {
          const existing = operationSnapshot.data() ?? {};
          if (
            existing['action'] !== 'create'
            || existing['ownerUid'] !== ownerUid
            || existing['photoId'] !== photoId
          ) {
            throw new HttpsError('already-exists', 'O requestId já foi utilizado para outra operação.');
          }
          return {
            campaignId: String(existing['campaignId'] ?? ''),
            status: String(existing['status'] ?? 'active'),
            created: false,
          };
        }

        assertInteractionAccessData(
          actorUserSnapshot.exists ? actorUserSnapshot.data() : null,
          actorAgeSnapshot.exists ? actorAgeSnapshot.data() : null,
          actor.uid
        );
        assertPhotoEligible(
          ownerUid,
          photoId,
          publicationSnapshot.exists ? publicationSnapshot.data() ?? {} : null,
          publicPhotoSnapshot.exists ? publicPhotoSnapshot.data() ?? {} : null,
          now
        );

        if (activeSlotSnapshot.exists) {
          const slot = activeSlotSnapshot.data() ?? {};
          const endsAt = Math.trunc(Number(slot['endsAt']));
          if (
            (slot['status'] === 'active' || slot['status'] === 'paused')
            && Number.isFinite(endsAt)
            && endsAt > now
          ) {
            throw new HttpsError(
              'resource-exhausted',
              'Esta foto já possui uma campanha promocional aberta.',
              { reason: 'photo_promotion_campaign_already_open' }
            );
          }
        }

        const billing = normalizeCommunityBoostBillingConfig(
          billingSnapshot.exists ? billingSnapshot.data() : null
        );
        const advertiser = normalizeCommunityBoostAdvertiserAccount(
          advertiserSnapshot.exists ? advertiserSnapshot.data() : null,
          actor.uid
        );
        if (!billing) {
          throw new HttpsError(
            'failed-precondition',
            'Promotion/Boost ainda não possui configuração comercial ativa.',
            { reason: 'promotion_boost_billing_config_required' }
          );
        }
        if (!advertiser) {
          throw new HttpsError(
            'failed-precondition',
            'Sua conta ainda não está elegível para faturamento de Promotion/Boost.',
            { reason: 'promotion_boost_advertiser_eligibility_required' }
          );
        }

        const requestedBudgetCents = Math.trunc(Number(request.data?.budgetCents));
        if (
          !Number.isFinite(requestedBudgetCents)
          || requestedBudgetCents <= 0
          || requestedBudgetCents > advertiser.maxCampaignBudgetCents
        ) {
          throw new HttpsError(
            'failed-precondition',
            'O orçamento excede a elegibilidade desta conta anunciante.',
            { maxCampaignBudgetCents: advertiser.maxCampaignBudgetCents }
          );
        }

        const campaign = buildPromotionBoostCampaign({
          campaignId: campaignRef.id,
          targetType: 'photo',
          targetId: photoId,
          targetOwnerUid: ownerUid,
          advertiserUid: actor.uid,
          budgetCents: requestedBudgetCents,
          dailyBudgetCents: request.data?.dailyBudgetCents,
          startsAt: request.data?.startsAt,
          endsAt: request.data?.endsAt,
          frequencyCapPerViewerPerDay: request.data?.frequencyCapPerViewerPerDay,
          billingConfig: billing,
          now,
        });
        if (!campaign) {
          throw new HttpsError('invalid-argument', 'Revise orçamento, período e frequency cap da campanha.');
        }

        transaction.create(campaignRef, campaign);
        transaction.set(activeSlotRef, {
          targetType: 'photo',
          ownerUid,
          photoId,
          advertiserUid: campaign.advertiserUid,
          campaignId: campaign.campaignId,
          status: campaign.status,
          startsAt: campaign.startsAt,
          endsAt: campaign.endsAt,
          expiresAt: campaign.endsAt + 7 * 24 * 60 * 60 * 1_000,
          updatedAt: now,
        }, { merge: false });
        transaction.create(operationRef, {
          requestId,
          action,
          actorUid: actor.uid,
          campaignId: campaign.campaignId,
          ownerUid,
          photoId,
          status: campaign.status,
          expiresAt: now + 7 * 24 * 60 * 60 * 1_000,
          createdAt: now,
        });
        transaction.create(db.collection('promotion_boost_audit').doc(), {
          action: 'photo_promotion_campaign_created',
          campaignId: campaign.campaignId,
          targetType: 'photo',
          ownerUid,
          photoId,
          actorUid: actor.uid,
          advertiserUid: campaign.advertiserUid,
          ledgerOwnershipTransferred: false,
          budgetCents: campaign.budgetCents,
          dailyBudgetCents: campaign.dailyBudgetCents,
          billingConfigVersion: campaign.billingConfigVersion,
          advertiserEligibilityPolicyVersion: advertiser.policyVersion,
          rateCpmCentsSnapshot: campaign.rateCpmCentsSnapshot,
          startsAt: campaign.startsAt,
          endsAt: campaign.endsAt,
          frequencyCapPerViewerPerDay: campaign.frequencyCapPerViewerPerDay,
          createdAt: now,
        });

        return { campaignId: campaign.campaignId, status: campaign.status, created: true };
      });
    }

    const campaignId = cleanId(request.data?.campaignId);
    if (!campaignId) {
      throw new HttpsError('invalid-argument', 'Campanha promocional inválida.');
    }

    const campaignRef = db.collection('promotion_boost_campaigns').doc(campaignId);
    return db.runTransaction(async (transaction) => {
      const [operationSnapshot, campaignSnapshot] = await Promise.all([
        transaction.get(operationRef),
        transaction.get(campaignRef),
      ]);
      if (operationSnapshot.exists) {
        const existing = operationSnapshot.data() ?? {};
        if (existing['action'] !== action || existing['campaignId'] !== campaignId) {
          throw new HttpsError('already-exists', 'O requestId já foi utilizado para outra operação.');
        }
        return { campaignId, status: String(existing['status'] ?? ''), created: false };
      }

      const campaign = campaignSnapshot.exists
        ? normalizePromotionBoostCampaign(campaignSnapshot.data())
        : null;
      if (!campaign || campaign.targetType !== 'photo') {
        throw new HttpsError('not-found', 'Campanha não encontrada.');
      }
      if (!actor.admin && campaign.advertiserUid !== actor.uid) {
        throw new HttpsError('permission-denied', 'Você não pode gerenciar esta campanha.');
      }

      if (action === 'resume') {
        if (now < campaign.startsAt || now >= campaign.endsAt) {
          throw new HttpsError(
            'failed-precondition',
            'O período desta campanha já foi encerrado.'
          );
        }

        const [publicationSnapshot, publicPhotoSnapshot, advertiserSnapshot] = await Promise.all([
          transaction.get(db.doc(`users/${campaign.targetOwnerUid}/photo_publications/${campaign.targetId}`)),
          transaction.get(db.doc(`public_profiles/${campaign.targetOwnerUid}/public_photos/${campaign.targetId}`)),
          transaction.get(db.collection('community_boost_advertiser_accounts').doc(campaign.advertiserUid)),
        ]);
        assertPhotoEligible(
          campaign.targetOwnerUid,
          campaign.targetId,
          publicationSnapshot.exists ? publicationSnapshot.data() ?? {} : null,
          publicPhotoSnapshot.exists ? publicPhotoSnapshot.data() ?? {} : null,
          now
        );
        if (!normalizeCommunityBoostAdvertiserAccount(
          advertiserSnapshot.exists ? advertiserSnapshot.data() : null,
          campaign.advertiserUid
        )) {
          throw new HttpsError('failed-precondition', 'A conta anunciante não está mais elegível.');
        }
      }

      const nextStatus =
        action === 'pause' ? 'paused'
          : action === 'resume' ? 'active'
            : 'canceled';
      if (
        (action === 'pause' && campaign.status !== 'active')
        || (action === 'resume' && campaign.status !== 'paused')
        || (action === 'cancel' && campaign.status !== 'active' && campaign.status !== 'paused')
      ) {
        throw new HttpsError('failed-precondition', 'A campanha não permite esta transição.');
      }

      transaction.update(campaignRef, {
        status: nextStatus,
        ...(action === 'cancel'
          ? { stoppedAt: now, stoppedReason: 'advertiser_canceled' }
          : {}),
        updatedAt: now,
      });

      const slotRef = db.collection('promotion_boost_active_slots').doc(
        `photo:${campaign.targetOwnerUid}:${campaign.targetId}`
      );
      if (action === 'cancel') {
        transaction.delete(slotRef);
      } else {
        transaction.set(slotRef, {
          targetType: 'photo',
          ownerUid: campaign.targetOwnerUid,
          photoId: campaign.targetId,
          advertiserUid: campaign.advertiserUid,
          campaignId,
          status: nextStatus,
          startsAt: campaign.startsAt,
          endsAt: campaign.endsAt,
          expiresAt: campaign.endsAt + 7 * 24 * 60 * 60 * 1_000,
          updatedAt: now,
        }, { merge: false });
      }

      transaction.create(operationRef, {
        requestId,
        action,
        actorUid: actor.uid,
        campaignId,
        status: nextStatus,
        expiresAt: now + 7 * 24 * 60 * 60 * 1_000,
        createdAt: now,
      });
      transaction.create(db.collection('promotion_boost_audit').doc(), {
        action: `photo_promotion_campaign_${action}`,
        campaignId,
        targetType: 'photo',
        ownerUid: campaign.targetOwnerUid,
        photoId: campaign.targetId,
        advertiserUid: campaign.advertiserUid,
        actorUid: actor.uid,
        previousStatus: campaign.status,
        nextStatus,
        ledgerOwnershipTransferred: false,
        createdAt: now,
      });

      return { campaignId, status: nextStatus, created: false };
    });
  }
);
