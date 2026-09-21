// functions/src/community-boost/get-community-boost-campaign-dashboard.handler.ts
// -----------------------------------------------------------------------------
// COMMUNITY BOOST CAMPAIGN DASHBOARD
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  REQUIRE_CALLABLE_APP_CHECK,
  assertCallableAppCheck,
} from '../shared/security/callable-app-check';
import {
  normalizeCommunityBoostCampaign,
} from './community-boost.policy';

interface GetCommunityBoostCampaignDashboardRequest {
  readonly campaignId?: unknown;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function cleanId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function isAdmin(token: Record<string, unknown> | undefined): boolean {
  const roles = Array.isArray(token?.['roles']) ? token?.['roles'] : [];
  return token?.['admin'] === true
    || token?.['role'] === 'admin'
    || roles.includes('admin');
}

export const getCommunityBoostCampaignDashboard =
  onCall<GetCommunityBoostCampaignDashboardRequest>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK,
    },
    async (request) => {
      assertCallableAppCheck(request.app);
      const uid = String(request.auth?.uid ?? '').trim();
      if (!uid) {
        throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
      }

      const campaignId = cleanId(request.data?.campaignId);
      if (!campaignId) {
        throw new HttpsError(
          'invalid-argument',
          'Campanha de Community Boost inválida.'
        );
      }

      const snapshot = await db
        .collection('community_boost_campaigns')
        .doc(campaignId)
        .get();
      const campaign = snapshot.exists
        ? normalizeCommunityBoostCampaign(snapshot.data())
        : null;

      if (!campaign) {
        throw new HttpsError('not-found', 'Campanha não encontrada.');
      }
      if (campaign.ownerUid !== uid && !isAdmin(request.auth?.token)) {
        throw new HttpsError(
          'permission-denied',
          'Você não pode consultar esta campanha.'
        );
      }

      const budgetMilliCents = campaign.budgetCents * 1_000;
      const remainingMilliCents = Math.max(
        budgetMilliCents - campaign.spentMilliCents,
        0
      );

      return {
        campaignId: campaign.campaignId,
        communityId: campaign.communityId,
        targetSourceType: campaign.targetSourceType,
        targetTagId: campaign.targetTagId,
        status: campaign.status,
        budgetCents: campaign.budgetCents,
        dailyBudgetCents: campaign.dailyBudgetCents,
        spentMilliCents: campaign.spentMilliCents,
        remainingMilliCents,
        currency: campaign.currency,
        billingBasis: campaign.billingBasis,
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
