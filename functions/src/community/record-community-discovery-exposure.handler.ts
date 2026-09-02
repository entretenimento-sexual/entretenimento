// functions/src/community/record-community-discovery-exposure.handler.ts
import { randomInt } from 'node:crypto';

import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { consumeBackendRateLimitQuota } from '../media/application/backend-rate-limit.service';
import {
  assertCommunityCallableAppCheck,
  REQUIRE_COMMUNITY_APP_CHECK,
} from './community-callable-security';
import {
  COMMUNITY_DISCOVERY_EXPOSURE_BURST_MAX_BATCHES,
  COMMUNITY_DISCOVERY_EXPOSURE_BURST_WINDOW_MS,
  COMMUNITY_DISCOVERY_EXPOSURE_COUNTER_SHARDS,
  COMMUNITY_DISCOVERY_EXPOSURE_HOURLY_MAX_BATCHES,
  COMMUNITY_DISCOVERY_EXPOSURE_HOURLY_WINDOW_MS,
  isCommunityDiscoveryExposureEligibleProjection,
  normalizeCommunityDiscoveryExposureRequest,
  resolveCommunityDiscoveryExposureDay,
  type CommunityDiscoveryExposureRequest,
} from './community-discovery-exposure.policy';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import { assertCommunitySocialAccessForUid } from './community-social-access.service';

interface CommunityDiscoveryExposureResponse {
  accepted: number;
  generatedAt: number;
}

function assertRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;
  throw new HttpsError(
    'failed-precondition',
    'A telemetria de descoberta não está disponível neste ambiente.'
  );
}

function assertActor(
  auth: { uid?: string; token?: Record<string, unknown> } | undefined
): string {
  const uid = String(auth?.uid ?? '').trim();
  if (!uid) throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  if (auth?.token?.['email_verified'] !== true) {
    throw new HttpsError('failed-precondition', 'Verifique seu e-mail para continuar.');
  }
  return uid;
}

async function consumeExposureQuota(uid: string): Promise<void> {
  await Promise.all([
    consumeBackendRateLimitQuota({
      scope: 'community_discovery_exposure_burst',
      subject: uid,
      maxRequests: COMMUNITY_DISCOVERY_EXPOSURE_BURST_MAX_BATCHES,
      windowMs: COMMUNITY_DISCOVERY_EXPOSURE_BURST_WINDOW_MS,
    }),
    consumeBackendRateLimitQuota({
      scope: 'community_discovery_exposure_hourly',
      subject: uid,
      maxRequests: COMMUNITY_DISCOVERY_EXPOSURE_HOURLY_MAX_BATCHES,
      windowMs: COMMUNITY_DISCOVERY_EXPOSURE_HOURLY_WINDOW_MS,
    }),
  ]);
}
