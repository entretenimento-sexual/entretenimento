// functions/src/promotion-boost/get-photo-promotion-campaign-dashboard.handler.ts
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { REQUIRE_CALLABLE_APP_CHECK, assertCallableAppCheck } from '../shared/security/callable-app-check';
import { normalizePromotionBoostCampaign } from './promotion-boost.policy';

interface Request { readonly campaignId?: unknown; }
const SAFE_ID = /^[A-Za-z0-9:_-]{1,128}$/;

function isAdmin(token: Record<string, unknown> | undefined): boolean {
  const roles = Array.isArray(token?.['roles']) ? token?.['roles'] : [];
  return token?.['admin'] === true || token?.['role'] === 'admin' || roles.includes('admin');
}

export const getPhotoPromotionCampaignDashboard = onCall<Request>(
  { region: FUNCTIONS_REGION, enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK },
  async (request) => {
    assertCallableAppCheck(request.app);
    const uid = String(request.auth?.uid ?? '').trim();
    if (!uid) throw new HttpsError('unauthenticated', 'Usuário não autenticado.');

    const campaignId = String(request.data?.campaignId ?? '').trim();
    if (!SAFE_ID.test(campaignId)) {
      throw new HttpsError('invalid-argument', 'Campanha promocional inválida.');
    }

    const snapshot = await db.collection('promotion_boost_campaigns').doc(campaignId).get();
    const campaign = snapshot.exists
      ? normalizePromotionBoostCampaign(snapshot.data())
      : null;

    if (!campaign || campaign.targetType !== 'photo') {
      throw new HttpsError('not-found', 'Campanha não encontrada.');
    }
    if (campaign.advertiserUid !== uid && !isAdmin(request.auth?.token)) {
      throw new HttpsError('permission-denied', 'Você não pode consultar esta campanha.');
    }

    return {
      campaignId: campaign.campaignId,
      targetType: 'photo',
      ownerUid: campaign.targetOwnerUid,
      photoId: campaign.targetId,
      advertiserUid: campaign.advertiserUid,
      status: campaign.status,
      stoppedAt: campaign.stoppedAt,
      stoppedReason: campaign.stoppedReason,
      budgetCents: campaign.budgetCents,
      dailyBudgetCents: campaign.dailyBudgetCents,
      spentMilliCents: campaign.spentMilliCents,
      remainingMilliCents: Math.max(
        campaign.budgetCents * 1_000 - campaign.spentMilliCents,
        0
      ),
      currency: campaign.currency,
      billingBasis: campaign.billingBasis,
      rateCpmCentsSnapshot: campaign.rateCpmCentsSnapshot,
      billingConfigVersion: campaign.billingConfigVersion,
      startsAt: campaign.startsAt,
      endsAt: campaign.endsAt,
      frequencyCapPerViewerPerDay: campaign.frequencyCapPerViewerPerDay,
      metrics: {
        deliveredCount: campaign.deliveredCount,
        qualifiedExposureCount: campaign.qualifiedExposureCount,
        clickCount: campaign.clickCount,
      },
      generatedAt: Date.now(),
    };
  }
);
