import { randomUUID } from 'node:crypto';
import type { UserRecord } from 'firebase-admin/auth';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { auth, db } from '../firebaseApp';
import { isFunctionsEmulatorRuntime } from '../shared/runtime/functions-runtime.guard';

import { ADULT_SELF_DECLARATION_VERSION } from '../compliance/platform-legal.constants';
import { normalizeRegistrationNicknameClaim } from './nickname-reservation.policy';

const PREVIEW_UID_PREFIX = 'email-link-preview-';
const DRAFT_LIFETIME_MS = 30 * 60_000;
const DRAFT_ID_PATTERN = /^[a-f0-9-]{36}$/;

export function emailLinkSignupEvidenceRef(uid: string) {
  return isFunctionsEmulatorRuntime() && uid.startsWith(PREVIEW_UID_PREFIX)
    ? db.collection('registration_email_link_drafts').doc(uid)
    : null;
}

export const stageEmailLinkRegistration = isFunctionsEmulatorRuntime() ? onCall<{
  email?: unknown;
  nickname?: unknown;
}>({ region: FUNCTIONS_REGION }, async (request): Promise<{ draftId: string }> => {
  requireLocalAuth();
  if (request.auth) throw new HttpsError('permission-denied', 'Encerre a sessão atual antes de continuar.');
  const email = typeof request.data?.email === 'string' ? request.data.email.trim().toLowerCase() : '';
  const nickname = normalizeRegistrationNicknameClaim(request.data?.nickname);
  if (!nickname || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new HttpsError('invalid-argument', 'Confira o apelido e o endereço de e-mail do cadastro.');
  }
  const draftId = randomUUID();
  await db.collection('registration_email_link_drafts').doc(draftId).create({
    email, nickname: nickname.display, expiresAtMs: Date.now() + DRAFT_LIFETIME_MS,
  });
  return { draftId };
}) : undefined;

function readDraftId(oobLink: string): string | null {
  const target = new URL(oobLink).searchParams.get('continueUrl');
  if (!target) return null;
  const url = new URL(target);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.pathname !== '/register/continuar-por-email') throw unavailableLink();
  const draftId = url.searchParams.get('draft');
  if (draftId !== null && !DRAFT_ID_PATTERN.test(draftId)) throw unavailableLink();
  return draftId;
}

async function bindSignupEvidence(uid: string, email: string, draftId: string | null): Promise<void> {
  const evidenceRef = emailLinkSignupEvidenceRef(uid);
  if (!evidenceRef) throw unavailableLink();
  await db.runTransaction(async tx => {
    const evidence = await tx.get(evidenceRef);
    if (evidence.exists) return;
    let nickname: string | null = null;
    if (draftId) {
      const draftRef = evidenceRef.parent.doc(draftId);
      const draft = (await tx.get(draftRef)).data();
      if (!draft || draft.email !== email || draft.expiresAtMs < Date.now()) throw unavailableLink();
      nickname = draft.nickname;
      tx.delete(draftRef);
    }
    tx.create(evidenceRef, {
      nickname,
      adultDeclaredAtMs: Date.now(),
      adultDeclarationVersion: ADULT_SELF_DECLARATION_VERSION,
    });
  });
}

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
    oobCodes?: { email: string; oobCode: string; oobLink: string; requestType: string }[];
  };
  const link = oobCodes?.find(entry => entry.requestType === 'EMAIL_SIGNIN' && entry.oobCode === code);
  if (!link) throw unavailableLink();
  const email = link.email.trim().toLowerCase();
  if (!email || (previousClientEmail !== undefined &&
      (typeof previousClientEmail !== 'string' || previousClientEmail.trim().toLowerCase() !== email))) {
    throw unavailableLink();
  }

  const draftId = readDraftId(link.oobLink);
  // Confira o rascunho antes de criar uma conta. A transação confirma a
  // vinculação e permite que a mesma preparação seja retomada.
  const existing = await findAccount(email);
  if (existing && (!isPreviewAccount(existing) || existing.passwordHash)) throw unavailableLink();
  if (draftId && !existing) {
    const draft = (await db.collection('registration_email_link_drafts').doc(draftId).get()).data();
    if (!draft || draft.email !== email || draft.expiresAtMs < Date.now()) throw unavailableLink();
  }

  let user: UserRecord;
  if (existing) {
    user = existing;
  } else {
    try {
      user = await auth.createUser({ uid: PREVIEW_UID_PREFIX + randomUUID(), email });
    } catch (error) {
      if ((error as { code?: string }).code !== 'auth/email-already-exists') throw error;
      const winner = await findAccount(email);
      if (!isPreviewAccount(winner) || winner.passwordHash) throw unavailableLink();
      user = winner;
    }
  }
  await bindSignupEvidence(user.uid, email, draftId);
  return { uid: user.uid, email };
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
}>({ region: FUNCTIONS_REGION }, async (request): Promise<{ passwordRequired: boolean; nickname?: string }> => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Confirme seu e-mail para continuar.');
  if (request.data?.expectedUid !== uid) {
    throw new HttpsError('permission-denied', 'A conta ativa mudou durante o cadastro.');
  }
  const passwordRequired = await registrationPasswordRequired(uid);
  const evidenceRef = emailLinkSignupEvidenceRef(uid);
  if (passwordRequired || !evidenceRef) return { passwordRequired };
  const nickname = (await evidenceRef.get()).get('nickname');
  return { passwordRequired, ...(typeof nickname === 'string' ? { nickname } : {}) };
}) : undefined;
