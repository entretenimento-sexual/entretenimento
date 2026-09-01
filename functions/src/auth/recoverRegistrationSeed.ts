import type { UserRecord } from 'firebase-admin/auth';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { auth, db, FieldValue } from '../firebaseApp';
import {
  generatePublicProfileId,
  normalizePublicProfileId,
} from '../identity/public-profile-id';
import { buildInitialUserSeed } from './user-registration-seed';

export interface RecoverRegistrationSeedResponse {
  ok: true;
  uid: string;
  created: boolean;
  recoveredAtMs: number;
}

/**
 * Recupera users/{uid} quando o documento não existe e corrige somente a
 * identidade pública canônica quando uma conta antiga ainda não possui
 * `profileId` válido.
 *
 * A operação é idempotente e não aceita payload do cliente. Todos os dados são
 * derivados do Firebase Auth e de defaults seguros do backend.
 */
export const recoverRegistrationSeed = onCall(
  { region: FUNCTIONS_REGION },
  async (request): Promise<RecoverRegistrationSeedResponse> => {
    const uid = String(request.auth?.uid ?? '').trim();

    if (!uid) {
      throw new HttpsError(
        'unauthenticated',
        'Faça login para recuperar os dados da conta.'
      );
    }

    let authUser: UserRecord;

    try {
      authUser = await auth.getUser(uid);
    } catch (error) {
      throw new HttpsError(
        'failed-precondition',
        'Não foi possível localizar a conta autenticada.',
        { cause: String((error as Error)?.message ?? error) }
      );
    }

    const recoveredAtMs = Date.now();
    const userRef = db.collection('users').doc(uid);
    const auditRef = db
      .collection('compliance_audit')
      .doc(`registration_recovery_${uid}_${recoveredAtMs}`);

    const created = await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(userRef);

      if (existing.exists) {
        if (!normalizePublicProfileId(existing.data()?.['profileId'])) {
          transaction.update(userRef, {
            profileId: generatePublicProfileId(),
          });

          transaction.create(auditRef, {
            uid,
            type: 'registration.public_profile_id_recovered',
            source: 'callable',
            createdAt: FieldValue.serverTimestamp(),
            createdAtMs: recoveredAtMs,
          });
        }

        return false;
      }

      transaction.create(
        userRef,
        buildInitialUserSeed(authUser, {
          nowMs: recoveredAtMs,
          source: 'registration-recovery',
        })
      );

      transaction.create(auditRef, {
        uid,
        type: 'registration.seed_recovered',
        source: 'callable',
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: recoveredAtMs,
      });

      return true;
    });

    return {
      ok: true,
      uid,
      created,
      recoveredAtMs,
    };
  }
);
