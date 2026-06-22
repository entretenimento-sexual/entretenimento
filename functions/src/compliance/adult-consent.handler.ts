import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';

const ADULT_CONSENT_VERSION = 'v1';

export const acceptAdultConsent = onCall(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{ ok: true; version: string }> => {
    const uid = request.auth?.uid?.trim();

    if (!uid) {
      throw new HttpsError('unauthenticated', 'Faça login para confirmar o acesso adulto.');
    }

    const now = FieldValue.serverTimestamp();

    await db.collection('users').doc(uid).set(
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

    await db.collection('compliance_audit').doc(`adult_consent_${uid}_${Date.now()}`).set({
      uid,
      type: 'adult_consent.accepted',
      version: ADULT_CONSENT_VERSION,
      source: 'web',
      createdAt: now,
    });

    return { ok: true, version: ADULT_CONSENT_VERSION };
  }
);
