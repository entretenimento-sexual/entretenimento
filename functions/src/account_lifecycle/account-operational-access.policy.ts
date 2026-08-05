import type { Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import { auth, db } from '../firebaseApp';

export type AccountOperationalCapability =
  | 'MEDIA_VIEW_PUBLIC'
  | 'MEDIA_VIEW_PRIVATE'
  | 'MEDIA_UPLOAD'
  | 'MEDIA_PUBLISH'
  | 'MEDIA_INTERACT'
  | 'MEDIA_MODERATE_OWN';

export type AccountOperationalDenyReason =
  | 'PROFILE_MISSING'
  | 'AUTH_DISABLED'
  | 'ACCOUNT_RESTRICTED'
  | 'EMAIL_UNVERIFIED'
  | 'ADULT_ACCESS_REQUIRED'
  | 'TERMS_REQUIRED'
  | 'PROFILE_INCOMPLETE';

export interface AccountOperationalAccessDecision {
  readonly allowed: boolean;
  readonly reason: AccountOperationalDenyReason | null;
}

export interface AccountOperationalAuthSnapshot {
  readonly disabled?: boolean;
  readonly emailVerified?: boolean;
}

export interface AccountOperationalUserDocument {
  readonly uid?: unknown;
  readonly accountStatus?: unknown;
  readonly suspended?: unknown;
  readonly interactionBlocked?: unknown;
  readonly accountLocked?: unknown;
  readonly loginAllowed?: unknown;
  readonly emailVerified?: unknown;
  readonly profileCompleted?: unknown;
  readonly idade?: unknown;
  readonly age?: unknown;
  readonly initialAdultConsentRequired?: unknown;
  readonly adultConsent?: unknown;
  readonly acceptedTerms?: unknown;
  readonly ageReverification?: unknown;
}

export interface AccountOperationalAccessOptions {
  readonly requireVerifiedEmail?: boolean;
  readonly requireCompletedProfile?: boolean;
  readonly requireAdultAccess?: boolean;
  readonly requireAcceptedTerms?: boolean;
  readonly allowMissingDocumentUid?: boolean;
}

const AGE_REVERIFICATION_RESTRICTED_STATES = new Set([
  'REQUIRED',
  'SUBMITTED',
  'UNDER_REVIEW',
  'REJECTED',
  'EXPIRED',
]);

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function nestedRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function normalizeEnum(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function denied(
  reason: AccountOperationalDenyReason
): AccountOperationalAccessDecision {
  return { allowed: false, reason };
}

function hasAdultAccess(user: AccountOperationalUserDocument): boolean {
  const declaredAge = user.idade ?? user.age;
  const adultConsent = nestedRecord(user.adultConsent);
  const ageReverification = nestedRecord(user.ageReverification);

  if (
    typeof declaredAge === 'number' &&
    Number.isFinite(declaredAge) &&
    declaredAge < 18
  ) {
    return false;
  }

  if (normalizeEnum(ageReverification['result']) === 'UNDERAGE') {
    return false;
  }

  if (
    AGE_REVERIFICATION_RESTRICTED_STATES.has(
      normalizeEnum(ageReverification['status'])
    )
  ) {
    return false;
  }

  if (adultConsent['accepted'] === false) {
    return false;
  }

  if (
    user.initialAdultConsentRequired !== false &&
    adultConsent['accepted'] !== true
  ) {
    return false;
  }

  return true;
}

function hasAcceptedTerms(user: AccountOperationalUserDocument): boolean {
  const acceptedTerms = nestedRecord(user.acceptedTerms);

  if (acceptedTerms['accepted'] === false) {
    return false;
  }

  if (acceptedTerms['adultAccessAcknowledgement'] === false) {
    return false;
  }

  if (
    user.initialAdultConsentRequired !== false &&
    acceptedTerms['accepted'] !== true
  ) {
    return false;
  }

  return true;
}

export function evaluateAccountOperationalAccess(
  rawUser: AccountOperationalUserDocument | null | undefined,
  expectedUid: string,
  authSnapshot: AccountOperationalAuthSnapshot = {},
  options: AccountOperationalAccessOptions = {}
): AccountOperationalAccessDecision {
  if (!rawUser || !cleanId(expectedUid)) {
    return denied('PROFILE_MISSING');
  }

  const documentUid = cleanId(rawUser.uid);
  const allowMissingDocumentUid = options.allowMissingDocumentUid === true;

  if (
    (!documentUid && !allowMissingDocumentUid) ||
    (documentUid && documentUid !== expectedUid)
  ) {
    return denied('PROFILE_MISSING');
  }

  if (authSnapshot.disabled === true) {
    return denied('AUTH_DISABLED');
  }

  const accountStatus = String(rawUser.accountStatus ?? 'active')
    .trim()
    .toLowerCase();

  if (
    accountStatus !== 'active' ||
    rawUser.suspended === true ||
    rawUser.interactionBlocked === true ||
    rawUser.accountLocked === true ||
    rawUser.loginAllowed === false
  ) {
    return denied('ACCOUNT_RESTRICTED');
  }

  const requireVerifiedEmail = options.requireVerifiedEmail !== false;
  const verifiedEmail =
    authSnapshot.emailVerified === true || rawUser.emailVerified === true;

  if (requireVerifiedEmail && !verifiedEmail) {
    return denied('EMAIL_UNVERIFIED');
  }

  if (options.requireAdultAccess !== false && !hasAdultAccess(rawUser)) {
    return denied('ADULT_ACCESS_REQUIRED');
  }

  if (
    options.requireAcceptedTerms !== false &&
    !hasAcceptedTerms(rawUser)
  ) {
    return denied('TERMS_REQUIRED');
  }

  if (
    options.requireCompletedProfile !== false &&
    rawUser.profileCompleted !== true
  ) {
    return denied('PROFILE_INCOMPLETE');
  }

  return { allowed: true, reason: null };
}

function actionLabel(capability: AccountOperationalCapability): string {
  switch (capability) {
  case 'MEDIA_VIEW_PUBLIC':
    return 'acessar mídias públicas';
  case 'MEDIA_VIEW_PRIVATE':
    return 'acessar sua biblioteca privada';
  case 'MEDIA_UPLOAD':
    return 'enviar mídias';
  case 'MEDIA_PUBLISH':
    return 'publicar mídias';
  case 'MEDIA_INTERACT':
    return 'realizar interações';
  case 'MEDIA_MODERATE_OWN':
    return 'restaurar ou alterar conteúdo';
  default:
    return 'realizar esta ação';
  }
}

export function assertAccountOperationalAccessDecision(
  decision: AccountOperationalAccessDecision,
  capability: AccountOperationalCapability
): void {
  if (decision.allowed) {
    return;
  }

  const reason = decision.reason ?? 'ACCOUNT_RESTRICTED';
  const details = { capability, reason };

  if (reason === 'PROFILE_MISSING') {
    throw new HttpsError(
      'failed-precondition',
      'Seu perfil não está disponível para esta ação.',
      details
    );
  }

  if (reason === 'EMAIL_UNVERIFIED') {
    throw new HttpsError(
      'failed-precondition',
      'Verifique seu e-mail antes de continuar.',
      details
    );
  }

  if (reason === 'ADULT_ACCESS_REQUIRED') {
    throw new HttpsError(
      'failed-precondition',
      'Conclua a verificação de acesso adulto antes de continuar.',
      details
    );
  }

  if (reason === 'TERMS_REQUIRED') {
    throw new HttpsError(
      'failed-precondition',
      'Aceite os termos vigentes antes de continuar.',
      details
    );
  }

  if (reason === 'PROFILE_INCOMPLETE') {
    throw new HttpsError(
      'failed-precondition',
      'Complete seu perfil antes de continuar.',
      details
    );
  }

  throw new HttpsError(
    'permission-denied',
    `Sua conta não pode ${actionLabel(capability)} no momento.`,
    details
  );
}

export function assertAccountOperationalAccessData(
  user: AccountOperationalUserDocument | null | undefined,
  expectedUid: string,
  capability: AccountOperationalCapability,
  authSnapshot: AccountOperationalAuthSnapshot = {},
  options: AccountOperationalAccessOptions = {}
): void {
  assertAccountOperationalAccessDecision(
    evaluateAccountOperationalAccess(
      user,
      expectedUid,
      authSnapshot,
      options
    ),
    capability
  );
}

export async function assertAccountOperationalAccess(
  uid: string,
  capability: AccountOperationalCapability,
  options: AccountOperationalAccessOptions = {}
): Promise<Record<string, unknown>> {
  const safeUid = cleanId(uid);

  if (!safeUid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  try {
    const [authUser, userSnapshot] = await Promise.all([
      auth.getUser(safeUid),
      db.doc(`users/${safeUid}`).get(),
    ]);
    const user = userSnapshot.exists
      ? userSnapshot.data() as AccountOperationalUserDocument
      : null;

    assertAccountOperationalAccessData(
      user,
      safeUid,
      capability,
      {
        disabled: authUser.disabled,
        emailVerified: authUser.emailVerified,
      },
      options
    );

    return userSnapshot.data() ?? {};
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }

    const code = String(
      (error as { code?: unknown; errorInfo?: { code?: unknown } })
        ?.errorInfo?.code ??
      (error as { code?: unknown })?.code ??
      ''
    ).trim().toLowerCase();

    if (code === 'auth/user-not-found') {
      throw new HttpsError(
        'failed-precondition',
        'Sua conta não está disponível para esta ação.'
      );
    }

    throw error;
  }
}

export async function assertAccountOperationalAccessInTransaction(
  transaction: Transaction,
  uid: string,
  capability: AccountOperationalCapability,
  authSnapshot: AccountOperationalAuthSnapshot = {},
  options: AccountOperationalAccessOptions = {}
): Promise<void> {
  const safeUid = cleanId(uid);

  if (!safeUid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  const userSnapshot = await transaction.get(db.doc(`users/${safeUid}`));

  assertAccountOperationalAccessData(
    userSnapshot.exists
      ? userSnapshot.data() as AccountOperationalUserDocument
      : null,
    safeUid,
    capability,
    authSnapshot,
    options
  );
}
