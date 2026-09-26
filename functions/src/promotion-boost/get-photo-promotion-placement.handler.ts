// functions/src/promotion-boost/get-photo-promotion-placement.handler.ts
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { assertInteractionAccessData } from '../account_lifecycle/interaction-access.policy';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { REQUIRE_CALLABLE_APP_CHECK, assertCallableAppCheck } from '../shared/security/callable-app-check';
import { consumeBackendRateLimitQuota } from '../shared/security/backend-rate-limit.service';
import { selectPhotoPromotionPlacement } from './photo-promotion-selection.service';

interface Request {
  readonly organicPhotoKeys?: unknown;
  readonly excludedPhotoKeys?: unknown;
}

const SAFE_KEY = /^[A-Za-z0-9:_-]{3,260}$/;
const MAX_IDS = 48;
const MIN_ORGANIC = 4;

function normalizeKeys(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > MAX_IDS) return null;
  const set = new Set<string>();
  for (const item of value) {
    const key = String(item ?? '').trim();
    if (!SAFE_KEY.test(key) || !key.includes(':')) return null;
    set.add(key);
  }
  return [...set];
}

export const getPhotoPromotionPlacement = onCall<Request>(
  { region: FUNCTIONS_REGION, enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK },
  async (request) => {
    assertCallableAppCheck(request.app);
    const uid = String(request.auth?.uid ?? '').trim();
    if (!uid) throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    if (request.auth?.token?.['email_verified'] !== true) {
      throw new HttpsError('failed-precondition', 'Verifique seu e-mail para continuar.');
    }

    const organic = normalizeKeys(request.data?.organicPhotoKeys);
    const extra =
      request.data?.excludedPhotoKeys === undefined
        ? []
        : normalizeKeys(request.data.excludedPhotoKeys);

    if (!organic || extra === null) {
      throw new HttpsError('invalid-argument', 'Contexto de Promotion/Boost inválido.');
    }

    const [userSnapshot, ageSnapshot] = await Promise.all([
      db.collection('users').doc(uid).get(),
      db.collection('age_eligibility_records').doc(uid).get(),
    ]);
    assertInteractionAccessData(
      userSnapshot.exists ? userSnapshot.data() : null,
      ageSnapshot.exists ? ageSnapshot.data() : null,
      uid
    );

    if (organic.length < MIN_ORGANIC) {
      return { placement: null, generatedAt: Date.now() };
    }

    await consumeBackendRateLimitQuota({
      action: 'photo_promotion_placement',
      subject: uid,
      config: {
        burstWindowMs: 5 * 60 * 1_000,
        burstMax: 30,
        sustainedWindowMs: 60 * 60 * 1_000,
        sustainedMax: 120,
      },
      message: 'Muitas solicitações patrocinadas foram recebidas em pouco tempo.',
    });

    const placement = await selectPhotoPromotionPlacement({
      viewerUid: uid,
      excludedPhotoKeys: [...new Set([...organic, ...extra])].slice(0, MAX_IDS),
      now: Date.now(),
    });

    return { placement, generatedAt: Date.now() };
  }
);
