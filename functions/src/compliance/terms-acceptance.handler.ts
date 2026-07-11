import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';

const TERMS_ACCEPTANCE_VERSION = 'v1';

export const acceptPlatformTerms = onCall(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{
    ok: true;
    version: string;
    acceptedAtMs: number;
  }> => {
    const uid = request.auth?.uid?.trim();

    if (!uid) {
      throw new HttpsError(
        'unauthenticated',
        'Faça login para aceitar os termos da plataforma.'
      );
    }

    const acceptedAtMs = Date.now();
    const now = FieldValue.serverTimestamp();
    const userRef = db.collection('users').doc(uid);
    const auditRef = db
      .collection('compliance_audit')
      .doc(`terms_acceptance_${uid}_${acceptedAtMs}`);

    const batch = db.batch();

    batch.set(
      userRef,
      {
        uid,
        acceptedTerms: {
          accepted: true,
          version: TERMS_ACCEPTANCE_VERSION,
          date: now,
          acceptedAt: now,
          updatedAt: now,
          source: 'web',
        },
      },
      { merge: true }
    );

    batch.set(auditRef, {
      uid,
      type: 'terms.accepted',
      version: TERMS_ACCEPTANCE_VERSION,
      source: 'web',
      createdAt: now,
    });

    await batch.commit();

    return {
      ok: true,
      version: TERMS_ACCEPTANCE_VERSION,
      acceptedAtMs,
    };
  }
);
