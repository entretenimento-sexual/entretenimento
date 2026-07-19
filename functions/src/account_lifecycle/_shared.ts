// functions/src/account_lifecycle/_shared.ts
import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../firebaseApp';
import { FUNCTIONS_REGION } from '../config/functions-region';

export const ACCOUNT_LIFECYCLE_REGION = FUNCTIONS_REGION;
export const MAX_LIFECYCLE_REASON_LENGTH = 500;
export const RECENT_AUTH_MAX_AGE_SECONDS = 10 * 60;

export type StaffPermission = 'users:suspend' | 'users:delete';

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

  role?: string | null;
  acceptedTerms?: {
    accepted?: boolean | null;
    version?: string | null;
  } | null;
  adultConsent?: {
    accepted?: boolean | null;
    version?: string | null;
  } | null;
  initialAdultConsentRequired?: boolean | null;

  accountStatus?: AccountStatus | string | null;
  publicVisibility?: 'visible' | 'hidden' | null;
  interactionBlocked?: boolean | null;
  loginAllowed?: boolean | null;
  suspended?: boolean | null;

  suspensionReason?: string | null;
  suspensionSource?: 'self' | 'moderator' | null;
  suspensionEndsAt?: number | null;

  deletionRequestedAt?: number | null;
  deletionRequestedBy?: 'self' | 'moderator' | null;
  deletionUndoUntil?: number | null;
  purgeAfter?: number | null;
  deletedAt?: number | null;

  deletionRestoreStatus?: RestorableAccountStatus | null;
  deletionRestoreSuspended?: boolean | null;
  deletionRestoreSuspensionReason?: string | null;
  deletionRestoreSuspensionSource?: 'self' | 'moderator' | null;
  deletionRestoreSuspensionEndsAt?: number | null;

  legalHold?: boolean;
  billingHold?: boolean;

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

export function normalizeNicknameForIndex(raw?: string | null): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 40);
}

export function resolveNicknameNormalized(user: UserDoc): string {
  const stored = String(user.nicknameNormalized ?? '').trim().toLowerCase();
  return /^[a-z0-9._-]{3,40}$/.test(stored)
    ? stored
    : normalizeNicknameForIndex(user.nickname);
}

export function getNicknameIndexDocId(user: UserDoc): string | null {
  const normalized = resolveNicknameNormalized(user);
  return /^[a-z0-9._-]{3,40}$/.test(normalized)
    ? `nickname:${normalized}`
    : null;
}

export function isUserEligibleForPublicProjection(user: UserDoc): boolean {
  const normalized = resolveNicknameNormalized(user);
  const adultConsentRequired =
    user.initialAdultConsentRequired !== false;

  return (
    user.emailVerified === true &&
    user.profileCompleted === true &&
    user.acceptedTerms?.accepted === true &&
    (!adultConsentRequired || user.adultConsent?.accepted === true) &&
    /^[a-z0-9._-]{3,40}$/.test(normalized) &&
    String(user.nickname ?? '').trim().length >= 3
  );
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
    avatarUrl: user.photoURL ?? null,
    municipio: user.municipio ?? null,
    estado: user.estado ?? null,
    gender: user.gender ?? null,
    orientation: user.orientation ?? null,
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

function hasElevatedRole(roles: string[]): boolean {
  return (
    roles.includes('superadmin') ||
    roles.includes('admin') ||
    roles.includes('moderator')
  );
}

function hasRequiredPermission(
  permissions: string[],
  requiredPermission: StaffPermission
): boolean {
  return (
    permissions.includes(requiredPermission) ||
    permissions.includes('users:lifecycle')
  );
}

export async function assertStaffAuthorization(params: {
  actorUid: string | null;
  authToken: Record<string, unknown> | undefined;
  requiredPermission: StaffPermission;
}): Promise<void> {
  const { actorUid, authToken, requiredPermission } = params;

  if (!actorUid) {
    throw new HttpsError('unauthenticated', 'Moderador não autenticado.');
  }

  const fromClaims = collectRolesAndPermissions(
    (authToken ?? {}) as Record<string, unknown>
  );
  if (
    hasElevatedRole(fromClaims.roles) ||
    hasRequiredPermission(fromClaims.permissions, requiredPermission)
  ) {
    return;
  }

  const actorSnap = await db.collection('users').doc(actorUid).get();
  const actorData = (actorSnap.data() ?? {}) as UserDoc;

  const fromUserDoc = collectRolesAndPermissions(
    actorData as Record<string, unknown>
  );
  if (
    hasElevatedRole(fromUserDoc.roles) ||
    hasRequiredPermission(fromUserDoc.permissions, requiredPermission)
  ) {
    return;
  }

  throw new HttpsError(
    'permission-denied',
    'Usuário sem permissão suficiente para esta ação.'
  );
}

export function createLifecycleAudit(
  tx: FirebaseFirestore.Transaction,
  payload: Record<string, unknown>
): void {
  const auditRef = db.collection('account_lifecycle_audit').doc();
  tx.set(auditRef, payload);
}
