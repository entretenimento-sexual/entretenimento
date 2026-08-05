import { HttpsError } from 'firebase-functions/v2/https';

import {
  assertAccountOperationalAccessData,
  type AccountOperationalAuthSnapshot,
  type AccountOperationalUserDocument,
} from '../../account_lifecycle/account-operational-access.policy';
import { auth, db } from '../../firebaseApp';

interface PrivateVideoUploadAuthSnapshot
  extends AccountOperationalAuthSnapshot {}

interface PrivateVideoUploadAccountSnapshot
  extends AccountOperationalUserDocument {}

function authErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return '';
  }

  const candidate = error as {
    code?: unknown;
    errorInfo?: { code?: unknown };
  };

  return String(candidate.errorInfo?.code ?? candidate.code ?? '')
    .trim()
    .toLowerCase();
}

/**
 * Nome preservado porque reserva, capacidade e registro já dependem desta
 * fronteira. A decisão agora usa diretamente a capacidade MEDIA_UPLOAD, sem
 * passar pelo alias mais permissivo de interação.
 */
export function assertPrivateVideoUploadEligibilityData(
  authUser: PrivateVideoUploadAuthSnapshot | null | undefined,
  user: PrivateVideoUploadAccountSnapshot | null | undefined,
  expectedUid: string
): void {
  if (!authUser || !user) {
    throw new HttpsError(
      'failed-precondition',
      'Seu perfil não está disponível para enviar vídeos.'
    );
  }

  assertAccountOperationalAccessData(
    user,
    expectedUid,
    'MEDIA_UPLOAD',
    authUser
  );
}

export async function assertPrivateVideoUploadEligibility(
  ownerUid: string
): Promise<Record<string, unknown>> {
  try {
    const [authUser, userSnapshot] = await Promise.all([
      auth.getUser(ownerUid),
      db.doc(`users/${ownerUid}`).get(),
    ]);
    const user = userSnapshot.exists
      ? userSnapshot.data() as Record<string, unknown>
      : null;

    assertPrivateVideoUploadEligibilityData(
      {
        disabled: authUser.disabled,
        emailVerified: authUser.emailVerified,
      },
      user as PrivateVideoUploadAccountSnapshot | null,
      ownerUid
    );

    return user ?? {};
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }

    if (authErrorCode(error) === 'auth/user-not-found') {
      throw new HttpsError(
        'failed-precondition',
        'Sua conta não está disponível para enviar vídeos.'
      );
    }

    throw error;
  }
}
