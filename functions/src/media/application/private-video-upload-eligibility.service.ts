import { HttpsError } from 'firebase-functions/v2/https';

import {
  assertMediaAuthoringEligibilityData,
} from './media-authoring-eligibility.service';
import { auth, db } from '../../firebaseApp';

interface PrivateMediaUploadAuthSnapshot {
  disabled?: boolean;
  emailVerified?: boolean;
}

interface PrivateMediaUploadAccountSnapshot {
  uid?: unknown;
  profileCompleted?: unknown;
  accountLocked?: unknown;
  loginAllowed?: unknown;
  accountStatus?: unknown;
  suspended?: unknown;
  interactionBlocked?: unknown;
  ageReverification?: {
    status?: unknown;
  } | null;
}

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

export function assertPrivateVideoUploadEligibilityData(
  authUser: PrivateMediaUploadAuthSnapshot | null | undefined,
  user: PrivateMediaUploadAccountSnapshot | null | undefined,
  expectedUid: string
): void {
  if (!authUser || !user) {
    throw new HttpsError(
      'failed-precondition',
      'Seu perfil não está disponível para enviar vídeos.'
    );
  }

  const documentUid = String(user.uid ?? expectedUid).trim();

  if (documentUid && documentUid !== expectedUid) {
    throw new HttpsError(
      'permission-denied',
      'O perfil informado não corresponde à conta autenticada.'
    );
  }

  if (
    authUser.disabled === true ||
    user.accountLocked === true ||
    user.loginAllowed === false
  ) {
    throw new HttpsError(
      'permission-denied',
      'Sua conta não está disponível para enviar vídeos.'
    );
  }

  assertMediaAuthoringEligibilityData(user);

  if (authUser.emailVerified !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Verifique seu e-mail antes de enviar vídeos.'
    );
  }

  if (user.profileCompleted !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Complete seu perfil antes de enviar vídeos.'
    );
  }
}

export async function assertPrivateVideoUploadEligibility(
  ownerUid: string
): Promise<void> {
  try {
    const [authUser, userSnapshot] =
      await Promise.all([
        auth.getUser(ownerUid),
        db.doc(`users/${ownerUid}`).get(),
      ]);

    assertPrivateVideoUploadEligibilityData(
      {
        disabled: authUser.disabled,
        emailVerified: authUser.emailVerified,
      },
      userSnapshot.exists
        ? userSnapshot.data() as PrivateMediaUploadAccountSnapshot
        : null,
      ownerUid
    );
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
