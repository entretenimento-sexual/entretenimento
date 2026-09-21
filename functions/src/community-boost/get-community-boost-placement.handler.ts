// functions/src/community-boost/get-community-boost-placement.handler.ts
// -----------------------------------------------------------------------------
// GET COMMUNITY BOOST PLACEMENT
// -----------------------------------------------------------------------------
// Endpoint patrocinado independente. Recebe somente contexto público da
// superfície e IDs orgânicos já visíveis para deduplicação. Não lê ou altera
// score v2/v3, cursor ou ordem orgânica.
// -----------------------------------------------------------------------------

import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { assertCommunitySocialAccessForUid } from '../community/community-social-access.service';
import { FUNCTIONS_REGION } from '../config/functions-region';
import {
  REQUIRE_CALLABLE_APP_CHECK,
  assertCallableAppCheck,
} from '../shared/security/callable-app-check';
import {
  consumeBackendRateLimitQuota,
} from '../shared/security/backend-rate-limit.service';
import {
  selectCommunityBoostSponsoredPlacementWithDiagnostics,
} from './community-boost-selection.service';
import {
  COMMUNITY_BOOST_MIN_ORGANIC_CARDS_FOR_PLACEMENT,
  normalizeCommunityBoostSourceType,
} from './community-boost.policy';

interface GetCommunityBoostPlacementRequest {
  readonly sourceType?: unknown;
  readonly tagId?: unknown;
  readonly organicCommunityIds?: unknown;
  readonly excludedCommunityIds?: unknown;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const MAX_IDS_PER_INPUT_LIST = 24;
const MAX_EFFECTIVE_EXCLUSIONS = 48;

function cleanOptionalTagId(value: unknown): string | null | undefined {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }
  const normalized = String(value).trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : undefined;
}

function normalizeCommunityIds(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > MAX_IDS_PER_INPUT_LIST) {
    return null;
  }

  const output: string[] = [];
  const seen = new Set<string>();
  for (const rawId of value) {
    const id = String(rawId ?? '').trim();
    if (!SAFE_ID_PATTERN.test(id)) return null;
    if (seen.has(id)) continue;
    seen.add(id);
    output.push(id);
  }

  return output;
}

export const getCommunityBoostPlacement =
  onCall<GetCommunityBoostPlacementRequest>(
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
      if (request.auth?.token?.['email_verified'] !== true) {
        throw new HttpsError(
          'failed-precondition',
          'Verifique seu e-mail para continuar.'
        );
      }

      const sourceType = normalizeCommunityBoostSourceType(
        request.data?.sourceType
      );
      const tagId = cleanOptionalTagId(request.data?.tagId);
      const organicCommunityIds = normalizeCommunityIds(
        request.data?.organicCommunityIds
      );
      const additionalExcludedCommunityIds =
        request.data?.excludedCommunityIds === undefined
          ? []
          : normalizeCommunityIds(request.data.excludedCommunityIds);

      if (
        !sourceType
        || tagId === undefined
        || !organicCommunityIds
        || additionalExcludedCommunityIds === null
      ) {
        throw new HttpsError(
          'invalid-argument',
          'Contexto de Community Boost inválido.'
        );
      }
      await assertCommunitySocialAccessForUid(uid);

      if (
        organicCommunityIds.length
        < COMMUNITY_BOOST_MIN_ORGANIC_CARDS_FOR_PLACEMENT
      ) {
        return {
          placement: null,
          generatedAt: Date.now(),
        };
      }

      if (sourceType === 'venue' && tagId !== null) {
        throw new HttpsError(
          'invalid-argument',
          'Interesse não se aplica a Espaços Oficiais patrocinados.'
        );
      }

      await consumeBackendRateLimitQuota({
        action: 'community_boost_placement',
        subject: uid,
        config: {
          burstWindowMs: 5 * 60 * 1_000,
          burstMax: 30,
          sustainedWindowMs: 60 * 60 * 1_000,
          sustainedMax: 120,
        },
        message: 'Muitas solicitações patrocinadas foram recebidas em pouco tempo.',
      });

      const selection =
        await selectCommunityBoostSponsoredPlacementWithDiagnostics({
          viewerUid: uid,
          sourceType,
          tagId,
          excludedCommunityIds: [
            ...new Set([
              ...organicCommunityIds,
              ...additionalExcludedCommunityIds,
            ]),
          ].slice(0, MAX_EFFECTIVE_EXCLUSIONS),
          now: Date.now(),
        });
      const placementServed = selection.placement !== null;
      const sharedControlReads = 2;
      const sharedControlWrites = 1;
      const readsProxy =
        sharedControlReads
        + selection.diagnostics.campaignQueryReadsProxy
        + selection.diagnostics.frequencyCapReads
        + selection.diagnostics.visibilityReads
        + selection.diagnostics.claimTransactionReads;
      const writesProxy =
        sharedControlWrites + selection.diagnostics.deliveryWrites;

      logger.info('community_boost_placement_cost_observed', {
        placementServed,
        sourceType,
        hasTagFilter: tagId !== null,
        campaignDocumentsFetched:
          selection.diagnostics.campaignDocumentsFetched,
        campaignQueryReadsProxy:
          selection.diagnostics.campaignQueryReadsProxy,
        eligibleCandidateCount: selection.diagnostics.eligibleCandidateCount,
        frequencyCapReads: selection.diagnostics.frequencyCapReads,
        visibilityReads: selection.diagnostics.visibilityReads,
        claimAttempts: selection.diagnostics.claimAttempts,
        claimTransactionReads: selection.diagnostics.claimTransactionReads,
        deliveryWrites: selection.diagnostics.deliveryWrites,
        sharedControlReads,
        sharedControlWrites,
        readsProxy,
        writesProxy,
        readsProxyPerServedPlacement: placementServed ? readsProxy : null,
        writesProxyPerServedPlacement: placementServed ? writesProxy : null,
        semantics:
          'document_operation_proxy_including_social_access_and_rate_limit',
      });

      return {
        placement: selection.placement,
        generatedAt: Date.now(),
      };
    }
  );
