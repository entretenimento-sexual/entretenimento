import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';

const ADULT_CONSENT_VERSION = 'v1';
const TERMS_ACCEPTANCE_VERSION = 'v1';

function hasAcceptedCurrentTerms(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  const version = String(record['version'] ?? '').trim();

  return (
    record['accepted'] === true &&
    (!version || version === TERMS_ACCEPTANCE_VERSION)
  );
}

export const acceptAdultConsent = onCall(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{ ok: true; version: string }> => {
    const uid = request.auth?.uid?.trim();

    if (!uid) {
      throw new HttpsError(
        'unauthenticated',
        'Faça login para confirmar o acesso adulto.'
      );
    }

    if (request.auth?.token?.email_verified !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Confirme seu e-mail antes de acessar esta etapa.'
      );
    }

    const acceptedAtMs = Date.now();
    const userRef = db.collection('users').doc(uid);
    const auditRef = db
      .collection('compliance_audit')
      .doc(`adult_consent_${uid}_${acceptedAtMs}`);

    await db.runTransaction(async (transaction) => {
      const userSnapshot = await transaction.get(userRef);

      if (!userSnapshot.exists) {
        throw new HttpsError(
          'failed-precondition',
          'Recupere os dados da sua conta antes de confirmar a maioridade.'
        );
      }

      const user = userSnapshot.data() ?? {};

      if (!hasAcceptedCurrentTerms(user['acceptedTerms'])) {
        throw new HttpsError(
          'failed-precondition',
          'Aceite os termos vigentes antes de confirmar a maioridade.'
        );
      }

      if (user['profileCompleted'] !== true) {
        throw new HttpsError(
          'failed-precondition',
          'Conclua seu perfil antes de confirmar a maioridade.'
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

      if (alreadyAccepted) {
        return;
      }

      const now = FieldValue.serverTimestamp();

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
        },
        { merge: true }
      );

      transaction.create(auditRef, {
        uid,
        type: 'adult_consent.accepted',
        version: ADULT_CONSENT_VERSION,
        source: 'web',
        createdAt: now,
        createdAtMs: acceptedAtMs,
      });
    });

    return { ok: true, version: ADULT_CONSENT_VERSION };
  }
);
