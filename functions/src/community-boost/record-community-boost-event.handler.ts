// functions/src/community-boost/record-community-boost-event.handler.ts
// -----------------------------------------------------------------------------
// COMMUNITY BOOST QUALIFIED EVENTS
// -----------------------------------------------------------------------------
// Eventos do navegador são telemetria agregada, nunca autoridade financeira.
// O faturamento acontece exclusivamente na concessão server-side do placement.
// Qualified exposure e clique servem para medir qualidade da entrega.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  REQUIRE_CALLABLE_APP_CHECK,
  assertCallableAppCheck,
} from '../shared/security/callable-app-check';
import {
  consumeBackendRateLimitQuota,
} from '../shared/security/backend-rate-limit.service';
import { assertCommunitySocialAccessForUid } from '../community/community-social-access.service';
import {
  normalizeCommunityBoostCampaign,
  resolveCommunityBoostDay,
} from './community-boost.policy';

type CommunityBoostEventType = 'qualified_exposure' | 'click';

interface RecordCommunityBoostEventRequest {
  readonly placementId?: unknown;
  readonly event?: unknown;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function cleanId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function hashViewer(uid: string): string {
  return createHash('sha256').update(uid).digest('hex').slice(0, 40);
}

function normalizeEvent(value: unknown): CommunityBoostEventType | null {
  return value === 'qualified_exposure' || value === 'click'
    ? value
    : null;
}

export const recordCommunityBoostEvent =
  onCall<RecordCommunityBoostEventRequest>(
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

      const placementId = cleanId(request.data?.placementId);
      const event = normalizeEvent(request.data?.event);
      if (!placementId || !event) {
        throw new HttpsError(
          'invalid-argument',
          'Evento de Community Boost inválido.'
        );
      }

      await assertCommunitySocialAccessForUid(uid);
      await consumeBackendRateLimitQuota({
        action: 'community_boost_event',
        subject: uid,
        config: {
          burstWindowMs: 5 * 60 * 1_000,
          burstMax: 60,
          sustainedWindowMs: 60 * 60 * 1_000,
          sustainedMax: 300,
        },
        message: 'Muitos eventos patrocinados foram recebidos em pouco tempo.',
      });

      const placementRef = db
        .collection('community_boost_placements')
        .doc(placementId);
      const now = Date.now();

      return db.runTransaction(async (transaction) => {
        const placementSnapshot = await transaction.get(placementRef);
        if (!placementSnapshot.exists) {
          throw new HttpsError('not-found', 'Placement patrocinado expirado.');
        }

        const placement = placementSnapshot.data() ?? {};
        const campaignId = cleanId(placement['campaignId']);
        const communityId = cleanId(placement['communityId']);
        const expectedViewerHash = hashViewer(uid);

        if (
          !campaignId
          || !communityId
          || placement['viewerHash'] !== expectedViewerHash
          || placement['status'] !== 'delivered'
          || !Number.isFinite(Number(placement['expiresAt']))
          || Number(placement['expiresAt']) < now
        ) {
          throw new HttpsError(
            'permission-denied',
            'Placement patrocinado indisponível.'
          );
        }

        const alreadyRecorded = event === 'qualified_exposure'
          ? placement['qualifiedExposureRecordedAt'] !== null
            && placement['qualifiedExposureRecordedAt'] !== undefined
          : placement['clickRecordedAt'] !== null
            && placement['clickRecordedAt'] !== undefined;

        if (alreadyRecorded) {
          return {
            accepted: true,
            idempotent: true,
            billable: Number(placement['billedMilliCents']) > 0,
          };
        }

        const campaignRef = db
          .collection('community_boost_campaigns')
          .doc(campaignId);
        const campaignSnapshot = await transaction.get(campaignRef);
        const campaign = campaignSnapshot.exists
          ? normalizeCommunityBoostCampaign(campaignSnapshot.data())
          : null;

        if (!campaign || campaign.communityId !== communityId) {
          throw new HttpsError(
            'data-loss',
            'Campanha patrocinada inconsistente.'
          );
        }

        const day = resolveCommunityBoostDay(now);
        const metricsRef = campaignRef.collection('metrics_daily').doc(day);

        if (event === 'click') {
          transaction.update(placementRef, {
            clickRecordedAt: now,
            updatedAt: now,
          });
          transaction.update(campaignRef, {
            clickCount: FieldValue.increment(1),
            updatedAt: now,
          });
          transaction.set(metricsRef, {
            day,
            deliveredCount: FieldValue.increment(0),
            qualifiedExposureCount: FieldValue.increment(0),
            clickCount: FieldValue.increment(1),
            billedMilliCents: FieldValue.increment(0),
            updatedAt: now,
          }, { merge: true });

          return {
            accepted: true,
            idempotent: false,
            billable: false,
          };
        }

        transaction.update(placementRef, {
          qualifiedExposureRecordedAt: now,
          updatedAt: now,
        });

        transaction.update(campaignRef, {
          qualifiedExposureCount: FieldValue.increment(1),
          updatedAt: now,
        });

        transaction.set(metricsRef, {
          day,
          deliveredCount: FieldValue.increment(0),
          qualifiedExposureCount: FieldValue.increment(1),
          clickCount: FieldValue.increment(0),
          billedMilliCents: FieldValue.increment(0),
          updatedAt: now,
        }, { merge: true });

        return {
          accepted: true,
          idempotent: false,
          billable: Number(placement['billedMilliCents']) > 0,
        };
      });
    }
  );
