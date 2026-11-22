// functions/src/account_lifecycle/_shared.ts
import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../firebaseApp';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { hasAcceptedCurrentTerms } from '../compliance/platform-legal.constants';
import { isNicknameIndexKey, resolveNicknameNormalized } from '../public_index/nickname-key.policy';

export const ACCOUNT_LIFECYCLE_REGION = FUNCTIONS_REGION;
export const MAX_LIFECYCLE_REASON_LENGTH = 500;
export const RECENT_AUTH_MAX_AGE_SECONDS = 10 * 60;

export type StaffPermission =
  | 'users:suspend'
  | 'users:delete'
  | 'users:deletion-operations'
  | 'platform:admin';

export type AccountStatus =
  | 'active'
  | 'self_suspended'
  | 'moderation_suspended'
  | 'pending_deletion'
  | 'deleted';

export type RestorableAccountStatus = Exclude<
  AccountStatus,
  'pending_deletion' | 'deleted'
>;

export type UserDoc = {
  uid?: string;
  email?: string | null;
  emailVerified?: boolean | null;
  profileCompleted?: boolean | null;

  nickname?: string | null;
  nicknameNormalized?: string | null;
  photoURL?: string | null;

  municipio?: string | null;
  estado?: string | null;
  gender?: string | null;
  orientation?: string | null;
  showOrientationPublicly?: boolean;

  role?: string | null;
  acceptedTerms?: {
    accepted?: boolean | null;
    version?: string | null;
    termsDocumentVersion?: string | null;
    privacyNoticeVersion?: string | null;
    acknowledgedPrivacyNotice?: boolean | null;
  } | null;
  adultConsent?: {
    accepted?: boolean | null;
    version?: string | null;
  } | null;
  initialAdultConsentRequired?: boolean | null;

  accountStatus?: AccountStatus | string | null;
  publicVisibility?: 'visible' | 'hidden' | null;
  interactionBlocked?: boolean | null;
  accountLocked?: boolean | null;
  loginAllowed?: boolean | null;
  suspended?: boolean | null;
  ageReverificationRestrictedAt?: unknown;
  ageReverificationSuspensionCaseId?: unknown;
  moderationAutomationHold?: { active?: boolean; expiresAtMs?: number } | null;

  suspensionReason?: string | null;
  suspensionSource?: 'self' | 'moderator' | 'automation' | null;
  suspensionEndsAt?: number | null;

  deletionRequestedAt?: number | null;
  deletionRequestedBy?: 'self' | 'moderator' | null;
  deletionUndoUntil?: number | null;
  purgeAfter?: number | null;
  deletedAt?: number | null;

  purgeStartedAt?: number | null;
  purgeAttemptCount?: number | null;
  purgeLastAttemptAt?: number | null;
  purgeBlockedReason?: string | null;
  purgeBlockedDomains?: string[] | null;

  deletionRestoreStatus?: RestorableAccountStatus | null;
  deletionRestoreSuspended?: boolean | null;
  deletionRestoreSuspensionReason?: string | null;
  deletionRestoreSuspensionSource?: 'self' | 'moderator' | 'automation' | null;
  deletionRestoreSuspensionEndsAt?: number | null;

  legalHold?: boolean;
  billingHold?: boolean;

  billingCancellationPending?: boolean | null;
  billingCancellationReason?: string | null;
  billingCancellationRequestedAt?: number | null;
  billingCancellationLastAttemptAt?: number | null;
  billingCancellationLastErrorCode?: string | null;

  staffRoles?: string[] | null;
  roles?: string[] | null;
  permissions?: string[] | null;
  admin?: boolean | null;
  moderator?: boolean | null;
  superadmin?: boolean | null;
};

export function assertRecentAuthentication(
  authToken: Record<string, unknown> | undefined,
  maxAgeSeconds = RECENT_AUTH_MAX_AGE_SECONDS
): void {
  const authTimeSeconds = Number(authToken?.['auth_time']);
  const nowSeconds = Math.floor(Date.now() / 1_000);
  const ageSeconds = nowSeconds - authTimeSeconds;

  if (
    !Number.isFinite(authTimeSeconds) ||
    authTimeSeconds <= 0 ||
    ageSeconds < -60 ||
    ageSeconds > maxAgeSeconds
  ) {
    throw new HttpsError(
      'failed-precondition',
      'Autenticação recente necessária para alterar o estado da conta.',
      {
        reason: 'recent-authentication-required',
        recommendedAction: 'sign_in_again',
        maxAgeSeconds,
      }
    );
  }
}

export function normalizeOptionalReason(reason?: string | null): string | null {
  return normalizeLifecycleReason(reason, false);
}

export function normalizeRequiredReason(reason?: string | null): string {
  return normalizeLifecycleReason(reason, true) ?? '';
}

function normalizeLifecycleReason(
  reason: unknown,
  required: boolean
): string | null {
  const safe = String(reason ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!safe) {
    if (required) {
      throw new HttpsError('invalid-argument', 'Motivo obrigatório.');
    }
    return null;
  }

  if (safe.length > MAX_LIFECYCLE_REASON_LENGTH) {
    throw new HttpsError(
      'invalid-argument',
      `O motivo deve ter no máximo ${MAX_LIFECYCLE_REASON_LENGTH} caracteres.`
    );
  }

  return safe;
}

export function isUserEligibleForPublicProjection(user: UserDoc): boolean {
  const normalized = resolveNicknameNormalized(user);
  const currentLegalAcceptance = hasAcceptedCurrentTerms(user.acceptedTerms);

  const accountActive =
    String(user.accountStatus ?? 'active').trim().toLowerCase() === 'active';

  return (
    accountActive &&
    user.suspended !== true &&
    user.interactionBlocked !== true &&
    user.accountLocked !== true &&
    (user.publicVisibility == null || user.publicVisibility === 'visible') &&
    user.loginAllowed !== false &&
    user.ageReverificationRestrictedAt == null &&
    user.ageReverificationSuspensionCaseId == null &&
    user.deletionRequestedAt == null &&
    user.deletedAt == null &&
    user.emailVerified === true &&
    user.profileCompleted === true &&
    currentLegalAcceptance &&
    isNicknameIndexKey(normalized) &&
    String(user.nickname ?? '').trim().length >= 3
  );
}

/** Avalia o estado resultante da reativação sem afastar restrições independentes. */
export function canRestorePublicProfileProjection(user: UserDoc): boolean {
  return user.moderationAutomationHold?.active !== true && isUserEligibleForPublicProjection({
    ...user, accountStatus: 'active', suspended: false,
    publicVisibility: 'visible', interactionBlocked: false,
  });
}

/**
 * Projeção pública mínima. Entitlement, tier e papel financeiro não são
 * copiados; o campo role público nasce neutro.
 */
export function buildPublicProfileSeed(
  user: UserDoc,
  uid: string,
  now: number
) {
  return {
    uid,
    nickname: String(user.nickname ?? '').trim(),
    nicknameNormalized: resolveNicknameNormalized(user),
    publicVisibility: 'visible',
    avatarUrl: user.photoURL ?? null,
    municipio: user.municipio ?? null,
    estado: user.estado ?? null,
    gender: user.gender ?? null,
    orientation: user.showOrientationPublicly === false ? null : user.orientation ?? null,
    role: 'free',
    createdAt: now,
    updatedAt: now,
  };
}

export function hashEmail(email?: string | null): string | null {
  const safe = String(email ?? '').trim().toLowerCase();
  if (!safe) return null;

  return createHash('sha256').update(safe).digest('hex');
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? '').trim().toLowerCase())
    .filter(Boolean);
}

function collectRolesAndPermissions(
  source: Partial<UserDoc> & { [key: string]: unknown }
): { roles: string[]; permissions: string[] } {
  const roles = new Set<string>();
  const permissions = new Set<string>();

  if (String(source.role ?? '').trim().toLowerCase() === 'admin') roles.add('admin');
  normalizeStringArray(source.staffRoles).forEach((role) => roles.add(role));
  normalizeStringArray(source.roles).forEach((role) => roles.add(role));
  normalizeStringArray(source.permissions).forEach((permission) =>
    permissions.add(permission)
  );

  if (source.superadmin === true) roles.add('superadmin');
  if (source.admin === true) roles.add('admin');
  if (source.moderator === true) roles.add('moderator');

  return {
    roles: [...roles],
    permissions: [...permissions],
  };
}

export function isActiveStaffAccount(user: Record<string, unknown> | null): user is Record<string, unknown> {
  return user !== null
    && user['suspended'] !== true
    && user['accountLocked'] !== true
    && user['interactionBlocked'] !== true
    && user['loginAllowed'] !== false
    && user['deletionRequestedAt'] == null
    && user['ageReverificationRestrictedAt'] == null
    && (user['accountStatus'] == null || user['accountStatus'] === 'active');
}

/** A autoridade é determinada pelo documento atual do operador. */
export function currentStaffPermissionAllows(
  user: Record<string, unknown> | null,
  requiredPermission: StaffPermission
): boolean {
  if (!isActiveStaffAccount(user)) return false;
  const { roles, permissions } = collectRolesAndPermissions(user);
  const administrator = roles.includes('admin') || roles.includes('superadmin');
  if (requiredPermission === 'platform:admin') return administrator;
  if (requiredPermission === 'users:deletion-operations') {
    return administrator || permissions.includes('users:delete')
      || permissions.includes('users:lifecycle');
  }
  return administrator || roles.includes('moderator')
    || permissions.includes(requiredPermission) || permissions.includes('users:lifecycle');
}

type StaffAuthorization = {
  actorUid: string | null;
  requiredPermission: StaffPermission;
};
type StaffActorReader = (uid: string) => Promise<Record<string, unknown> | null>;

export async function assertStaffAuthorizationWithReader(
  { actorUid, requiredPermission }: StaffAuthorization,
  readActor: StaffActorReader
): Promise<void> {
  if (!actorUid) {
    throw new HttpsError('unauthenticated', 'Operador não autenticado.');
  }

  if (!currentStaffPermissionAllows(await readActor(actorUid), requiredPermission)) {
    throw new HttpsError('permission-denied', 'Usuário sem permissão suficiente para esta ação.');
  }
}

export async function readCurrentStaffAccount(
  uid: string,
  transaction?: FirebaseFirestore.Transaction
): Promise<Record<string, unknown> | null> {
  const ref = db.collection('users').doc(uid);
  const snapshot = await (transaction ? transaction.get(ref) : ref.get());
  return snapshot.data() ?? null;
}

export async function assertStaffAuthorization(
  params: StaffAuthorization,
  transaction?: FirebaseFirestore.Transaction
): Promise<void> {
  return assertStaffAuthorizationWithReader(params, (uid) => readCurrentStaffAccount(uid, transaction));
}

export async function assertPlatformAdministrator(
  uid: string | undefined,
  transaction?: FirebaseFirestore.Transaction
): Promise<string> {
  const actorUid = uid?.trim();
  if (!actorUid) throw new HttpsError('unauthenticated', 'Administrador não autenticado.');

  await assertStaffAuthorization({ actorUid, requiredPermission: 'platform:admin' }, transaction);
  return actorUid;
}

export async function hasCurrentPlatformAdministrator(
  uid: string,
  transaction?: FirebaseFirestore.Transaction
): Promise<boolean> {
  return currentStaffPermissionAllows(await readCurrentStaffAccount(uid, transaction), 'platform:admin');
}

export function createLifecycleAudit(
  tx: FirebaseFirestore.Transaction,
  payload: Record<string, unknown>
): void {
  const auditRef = db.collection('account_lifecycle_audit').doc();
  tx.set(auditRef, payload);
}
