import { createHash, randomUUID } from 'node:crypto';
import type { UserRecord } from 'firebase-admin/auth';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { auth, db } from '../firebaseApp';
import { isFunctionsEmulatorRuntime } from '../shared/runtime/functions-runtime.guard';

import { requiresTrustedAdultVerification } from '../compliance/adult-self-declaration-evidence';
import { ADULT_SELF_DECLARATION_VERSION } from '../compliance/platform-legal.constants';
import { normalizeRegistrationNicknameClaim } from './nickname-reservation.policy';
import { REGISTRATION_EMAIL_LINK_DRAFTS } from './registration-abandonment.policy';
import { recordRegistrationAuthProgress } from './registration-auth-progress.handler';
import { REGISTRATION_EMAIL_LINK_UID_PREFIX } from './registration-auth-progress.policy';

const emailLinkPreviewAllowed = isFunctionsEmulatorRuntime() && !requiresTrustedAdultVerification;
const PREVIEW_UID_PREFIX = REGISTRATION_EMAIL_LINK_UID_PREFIX;
// A vinculação e a triagem revalidam a expiração dentro de suas transações.
const DRAFT_LIFETIME_MS = 30 * 60_000;
const DRAFT_ID_PATTERN = /^[a-f0-9-]{36}$/;
const LINK_CODE_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;
const drafts = () => db.collection(REGISTRATION_EMAIL_LINK_DRAFTS);

type BlockedLinkState = 'sign-in' | 'unavailable' | 'draft-expired';
type LinkLookup = { state: BlockedLinkState } | {
  state: 'confirm';
  email: string;
  draftId: string | null;
  existing?: UserRecord;
};

function linkCodeHash(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export function emailLinkSignupEvidenceRef(uid: string) {
  return isFunctionsEmulatorRuntime() && uid.startsWith(PREVIEW_UID_PREFIX)
    ? drafts().doc(uid)
    : null;
}

export const stageEmailLinkRegistration = emailLinkPreviewAllowed ? onCall<{
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
  await drafts().doc(draftId).create({
    email, nickname: nickname.display, expiresAtMs: Date.now() + DRAFT_LIFETIME_MS,
  });
  return { draftId };
}) : undefined;

function readDraftId(oobLink: string): string | null {
  const target = new URL(oobLink).searchParams.get('continueUrl');
  if (!target) return null;
  const url = URL.canParse(target) ? new URL(target) : null;
  if (!url || url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.pathname !== '/register/continuar-por-email') throw blockedLinkError('unavailable');
  const draftId = url.searchParams.get('draft');
  if (draftId !== null && !DRAFT_ID_PATTERN.test(draftId)) throw blockedLinkError('unavailable');
  return draftId;
}

async function bindSignupEvidence(
  uid: string, email: string, draftId: string | null, code: string
): Promise<void> {
  const evidenceRef = emailLinkSignupEvidenceRef(uid);
  if (!evidenceRef) throw blockedLinkError('unavailable');
  await db.runTransaction(async tx => {
    const evidence = await tx.get(evidenceRef);
    const codeHash = linkCodeHash(code);
    if (evidence.exists) {
      if (evidence.get('oobCodeHash') !== codeHash) tx.update(evidenceRef, { oobCodeHash: codeHash });
      return;
    }
    let nickname: string | null = null;
    if (draftId) {
      const draftRef = evidenceRef.parent.doc(draftId);
      const draft = (await tx.get(draftRef)).data();
      if (!isValidDraft(draft, email)) throw blockedLinkError('draft-expired');
      nickname = draft.nickname;
      tx.delete(draftRef);
    }
    // A mesma coleção também guarda este recibo por UID, usado na retomada e
    // na conciliação da declaração 18+. A limpeza de rascunhos deve preservar o recibo.
    tx.create(evidenceRef, {
      nickname,
      oobCodeHash: codeHash,
      adultDeclaredAtMs: Date.now(),
      adultDeclarationVersion: ADULT_SELF_DECLARATION_VERSION,
    });
  });
}

const BLOCKED_LINK_REASONS = {
  'sign-in': 'registration/account-already-created',
  'unavailable': 'registration/email-link-unavailable',
  'draft-expired': 'registration/email-link-draft-expired',
} as const satisfies Record<BlockedLinkState, string>;

function blockedLinkError(state: BlockedLinkState): HttpsError {
  return new HttpsError('failed-precondition', 'O link não está disponível para criar uma conta.', {
    reason: BLOCKED_LINK_REASONS[state],
  });
}

function isValidDraft(draft: FirebaseFirestore.DocumentData | undefined, email: string):
  draft is FirebaseFirestore.DocumentData {
  return !!draft && draft['email'] === email && draft['expiresAtMs'] > Date.now();
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

async function lookupSignupLink(code: string, emulatorCodesUrl: URL): Promise<LinkLookup> {
  // Both the initial check and the submission ask Auth about the supplied code.
  const response = await fetch(emulatorCodesUrl, { signal: AbortSignal.timeout(5_000) })
    .catch(() => { throw new HttpsError('unavailable', 'Não foi possível consultar o Auth Emulator.'); });
  if (!response.ok) throw new HttpsError('unavailable', 'Não foi possível validar o link agora.');
  const { oobCodes } = await response.json() as {
    oobCodes?: { email: string; oobCode: string; oobLink: string; requestType: string }[];
  };
  const link = oobCodes?.find(entry => entry.requestType === 'EMAIL_SIGNIN' && entry.oobCode === code);
  if (!link) {
    const receipts = await drafts().where('oobCodeHash', '==', linkCodeHash(code)).limit(1).get();
    const receipt = receipts.docs[0];
    const account = receipt
      ? await auth.getUser(receipt.id).catch(error => {
        if ((error as { code?: string }).code === 'auth/user-not-found') return undefined;
        throw error;
      })
      : undefined;
    return { state: isPreviewAccount(account) && account.emailVerified && account.passwordHash
      ? 'sign-in' : 'unavailable' };
  }

  const email = link.email.trim().toLowerCase();
  if (!email) return { state: 'unavailable' };
  const existing = await findAccount(email);
  if (existing?.disabled) return { state: 'unavailable' };
  if (existing && (!isPreviewAccount(existing) || existing.passwordHash)) return { state: 'sign-in' };

  let draftId: string | null;
  try {
    draftId = readDraftId(link.oobLink);
  } catch {
    return { state: 'unavailable' };
  }
  if (draftId) {
    const evidence = existing ? await emailLinkSignupEvidenceRef(existing.uid)?.get() : null;
    if (!evidence?.exists) {
      const draft = (await drafts().doc(draftId).get()).data();
      if (!isValidDraft(draft, email)) return { state: 'draft-expired' };
    }
  }
  return { state: 'confirm', email, draftId, existing };
}

export const inspectEmailLinkRegistration = emailLinkPreviewAllowed ? onCall<{ code?: unknown }>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{ state: LinkLookup['state'] }> => {
    const url = requireLocalAuth();
    if (request.auth) throw new HttpsError('permission-denied', 'Encerre a sessão atual antes de continuar.');
    const code = request.data?.code;
    if (typeof code !== 'string' || !LINK_CODE_PATTERN.test(code)) return { state: 'unavailable' };
    const result = await lookupSignupLink(code, url);
    // This check does not create an account and never returns the recipient.
    return { state: result.state };
  }
) : undefined;

/** Reserve a fresh Auth identity before calling the Firebase native sign-in API. */
export const prepareEmailLinkRegistration = emailLinkPreviewAllowed ? onCall<{
  email?: unknown;
  code?: unknown;
  confirmsAdult?: unknown;
}>({ region: FUNCTIONS_REGION }, async (request): Promise<{ uid: string; email: string }> => {
  const emulatorCodesUrl = requireLocalAuth();
  if (request.auth) throw new HttpsError('permission-denied', 'Encerre a sessão atual antes de continuar.');
  const { code, confirmsAdult, email: previousClientEmail } = request.data ?? {};
  if (confirmsAdult !== true || typeof code !== 'string' || !LINK_CODE_PATTERN.test(code)) {
    throw new HttpsError('invalid-argument', 'Confira o link e a declaração de maioridade.');
  }
  const link = await lookupSignupLink(code, emulatorCodesUrl);
  if (link.state !== 'confirm') throw blockedLinkError(link.state);
  const { email, draftId, existing } = link;
  if (previousClientEmail !== undefined &&
      (typeof previousClientEmail !== 'string' || previousClientEmail.trim().toLowerCase() !== email)) {
    throw blockedLinkError('unavailable');
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
      if (!winner || winner.disabled) throw blockedLinkError('unavailable');
      if (!isPreviewAccount(winner) || winner.passwordHash) throw blockedLinkError('sign-in');
      user = winner;
    }
  }
  await bindSignupEvidence(user.uid, email, draftId, code);
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
  if (!evidenceRef) return { passwordRequired };
  await recordRegistrationAuthProgress(uid);
  if (passwordRequired) return { passwordRequired };
  const nickname = (await evidenceRef.get()).get('nickname');
  return { passwordRequired, ...(typeof nickname === 'string' ? { nickname } : {}) };
}) : undefined;
