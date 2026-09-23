import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  REQUIRE_CALLABLE_APP_CHECK,
  assertCallableAppCheck,
} from '../shared/security/callable-app-check';
import {
  consumeBackendRateLimitQuota,
} from '../shared/security/backend-rate-limit.service';
import {
  evaluateCanonicalAgeEligibility,
} from './age-eligibility.policy';
import {
  ADULT_CONSENT_VERSION,
  TERMS_ACCEPTANCE_VERSION,
} from './platform-legal.constants';

const ADULT_CONSENT_RATE_LIMIT = Object.freeze({
  burstWindowMs: 10 * 60 * 1_000,
  burstMax: 10,
  sustainedWindowMs: 24 * 60 * 60 * 1_000,
  sustainedMax: 50,
});

function hasAcceptedCurrentTerms(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  const version = String(record['version'] ?? '').trim();

  return (
    record['accepted'] === true &&
    version === TERMS_ACCEPTANCE_VERSION &&
    record['acknowledgedPrivacyNotice'] === true
  );
}

export const acceptAdultConsent = onCall(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK,
  },
  async (request): Promise<{ ok: true; version: string }> => {
    assertCallableAppCheck(request.app);
    const uid = request.auth?.uid?.trim();

    if (!uid) {
      throw new HttpsError(
        'unauthenticated',
        'Faça login para confirmar o acesso adulto.'
      );
    }

    const acceptedAtMs = Date.now();

    await consumeBackendRateLimitQuota({
      action: 'compliance:adult-consent',
      subject: uid,
      config: ADULT_CONSENT_RATE_LIMIT,
      message:
        'Muitas confirmações foram enviadas em pouco tempo. Tente novamente mais tarde.',
      now: acceptedAtMs,
    });

    const userRef = db.collection('users').doc(uid);
    const auditRef = db
      .collection('compliance_audit')
      .doc(`adult_consent_${uid}_${acceptedAtMs}`);

    await db.runTransaction(async (transaction) => {
      const ageEligibilityRef = db
        .collection('age_eligibility_records')
        .doc(uid);
      const [userSnapshot, ageEligibilitySnapshot] = await Promise.all([
        transaction.get(userRef),
        transaction.get(ageEligibilityRef),
      ]);

      if (!userSnapshot.exists) {
        throw new HttpsError(
          'failed-precondition',
          'Recupere os dados da sua conta antes de aceitar o acesso adulto.'
        );
      }

      const user = userSnapshot.data() ?? {};

      if (!hasAcceptedCurrentTerms(user['acceptedTerms'])) {
        throw new HttpsError(
          'failed-precondition',
          'Aceite os termos vigentes antes de aceitar o acesso adulto.'
        );
      }

      const ageDecision = evaluateCanonicalAgeEligibility({
        uid,
        rawRecord: ageEligibilitySnapshot.exists
          ? ageEligibilitySnapshot.data()
          : null,
        nowMs: acceptedAtMs,
      });

      if (!ageDecision.allowed) {
        throw new HttpsError(
          ageDecision.denialReason === 'underage'
            ? 'permission-denied'
            : 'failed-precondition',
          ageDecision.denialReason === 'underage'
            ? 'O acesso adulto não está disponível para esta conta.'
            : 'Conclua a verificação de maioridade antes de aceitar o acesso adulto.',
          {
            reason: ageDecision.denialReason,
            recommendedAction: 'complete_age_verification',
          }
        );
      }

      const currentConsent = user['adultConsent'];
      const alreadyAccepted =
        !!currentConsent &&
        typeof currentConsent === 'object' &&
        (currentConsent as Record<string, unknown>)['accepted'] === true &&
        String(
          (currentConsent as Record<string, unknown>)['version'] ?? ''
        ).trim() === ADULT_CONSENT_VERSION;
      const now = FieldValue.serverTimestamp();

      if (alreadyAccepted) {
        if (user['initialAdultConsentRequired'] === true) {
          transaction.set(
            userRef,
            {
              initialAdultConsentRequired: false,
              updatedAt: now,
            },
            { merge: true }
          );
        }

        return;
      }

      transaction.set(
        userRef,
        {
          uid,
          adultConsent: {
            accepted: true,
            version: ADULT_CONSENT_VERSION,
            acceptedAt: now,
            updatedAt: now,
            source: 'web',
          },
          initialAdultConsentRequired: false,
          updatedAt: now,
        },
        { merge: true }
      );

      transaction.create(auditRef, {
        uid,
        type: 'adult_experience_consent.accepted',
        version: ADULT_CONSENT_VERSION,
        termsAcceptanceVersion: TERMS_ACCEPTANCE_VERSION,
        source: 'web',
        createdAt: now,
        createdAtMs: acceptedAtMs,
      });
    });

    return { ok: true, version: ADULT_CONSENT_VERSION };
  }
);
