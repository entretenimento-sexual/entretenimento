import { randomUUID } from 'node:crypto';
import type { UserRecord } from 'firebase-admin/auth';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { auth } from '../firebaseApp';
import { isFunctionsEmulatorRuntime } from '../shared/runtime/functions-runtime.guard';

const PREVIEW_UID_PREFIX = 'email-link-preview-';

function unavailableLink(): HttpsError {
  return new HttpsError('failed-precondition', 'Este link não pode mais ser usado.', {
    reason: 'registration/email-link-unavailable',
  });
}

function isPreviewAccount(user: UserRecord | undefined): user is UserRecord {
  return !!user && user.uid.startsWith(PREVIEW_UID_PREFIX) && !user.disabled;
}

async function findAccount(email: string): Promise<UserRecord | undefined> {
  try {
    return await auth.getUserByEmail(email);
  } catch (error) {
    if ((error as { code?: string }).code === 'auth/user-not-found') return undefined;
    throw error;
  }
}

function requireLocalAuth(): URL {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '';
  const project = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? '';
  if (!isFunctionsEmulatorRuntime() ||
      !/^(?:127\.0\.0\.1|localhost|\[::1\]):[0-9]{1,5}$/.test(host) ||
      !/^[a-z0-9-]+$/.test(project)) {
    throw new HttpsError('unavailable', 'O cadastro por link exige o ambiente emulado local.');
  }
  return new URL(`http://${host}/emulator/v1/projects/${project}/oobCodes`);
}

/** Reserve a fresh Auth identity before calling the Firebase native sign-in API. */
export const prepareEmailLinkRegistration = isFunctionsEmulatorRuntime() ? onCall<{
  email?: unknown;
  code?: unknown;
  confirmsAdult?: unknown;
}>({ region: FUNCTIONS_REGION }, async (request): Promise<{ uid: string; email: string }> => {
  const emulatorCodesUrl = requireLocalAuth();
  if (request.auth) throw new HttpsError('permission-denied', 'Encerre a sessão atual antes de continuar.');
  const { code, confirmsAdult, email: previousClientEmail } = request.data ?? {};
  if (confirmsAdult !== true || typeof code !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(code)) {
    throw new HttpsError('invalid-argument', 'Confira o link e a declaração de maioridade.');
  }

  // Resolve the recipient from the pending, high-entropy Auth Emulator code.
  // Only the holder of a valid signup link can receive the associated identity.
  const response = await fetch(emulatorCodesUrl, { signal: AbortSignal.timeout(5_000) })
    .catch(() => { throw new HttpsError('unavailable', 'Não foi possível consultar o Auth Emulator.'); });
  if (!response.ok) throw new HttpsError('unavailable', 'Não foi possível validar o link agora.');
  const { oobCodes } = await response.json() as {
    oobCodes?: { email: string; oobCode: string; requestType: string }[];
  };
  const link = oobCodes?.find(entry => entry.requestType === 'EMAIL_SIGNIN' && entry.oobCode === code);
  const email = link?.email.trim().toLowerCase();
  if (!email || (previousClientEmail !== undefined &&
      (typeof previousClientEmail !== 'string' || previousClientEmail.trim().toLowerCase() !== email))) {
    throw unavailableLink();
  }

  const existing = await findAccount(email);
  if (existing) {
    if (!isPreviewAccount(existing) || existing.passwordHash) throw unavailableLink();
    return { uid: existing.uid, email };
  }

  try {
    const user = await auth.createUser({ uid: PREVIEW_UID_PREFIX + randomUUID(), email });
    return { uid: user.uid, email };
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/email-already-exists') throw error;
    // The Auth uniqueness check arbitrates races with normal signup. Never modify the winner.
    const winner = await findAccount(email);
    if (!isPreviewAccount(winner) || winner.passwordHash) throw unavailableLink();
    return { uid: winner.uid, email };
  }
}) : undefined;

export async function registrationPasswordRequired(uid: string): Promise<boolean> {
  if (!isFunctionsEmulatorRuntime() || !uid.startsWith(PREVIEW_UID_PREFIX)) return false;
  requireLocalAuth();
  const user = await auth.getUser(uid);
  return !isPreviewAccount(user) || !user.emailVerified || !user.passwordHash;
}

export async function assertRegistrationPasswordDefined(uid: string): Promise<void> {
  if (await registrationPasswordRequired(uid)) {
    throw new HttpsError('failed-precondition', 'Defina sua senha antes de continuar.', {
      reason: 'registration/password-required',
    });
  }
}

export const getEmailLinkRegistrationState = isFunctionsEmulatorRuntime() ? onCall<{
  expectedUid?: unknown;
}>({ region: FUNCTIONS_REGION }, async (request): Promise<{ passwordRequired: boolean }> => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Confirme seu e-mail para continuar.');
  if (request.data?.expectedUid !== uid) {
    throw new HttpsError('permission-denied', 'A conta ativa mudou durante o cadastro.');
  }
  return { passwordRequired: await registrationPasswordRequired(uid) };
}) : undefined;
