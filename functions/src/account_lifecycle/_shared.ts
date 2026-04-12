//functions\src\account_lifecycle\_shared.ts
import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../firebaseApp';

export const ACCOUNT_LIFECYCLE_REGION = 'southamerica-east1';

export type StaffPermission = 'users:suspend' | 'users:delete';

export type AccountStatus =
  | 'active'
  | 'self_suspended'
  | 'moderation_suspended'
  | 'pending_deletion'
  | 'deleted';

export type UserDoc = {
  uid?: string;
  email?: string | null;

  nickname?: string | null;
  nicknameNormalized?: string | null;
  photoURL?: string | null;

  municipio?: string | null;
  estado?: string | null;
  gender?: string | null;
  orientation?: string | null;

  role?: string | null;

  accountStatus?: AccountStatus | string | null;
  publicVisibility?: 'visible' | 'hidden' | null;
  interactionBlocked?: boolean | null;
  loginAllowed?: boolean | null;

  suspensionReason?: string | null;
  suspensionSource?: 'self' | 'moderator' | null;
  suspensionEndsAt?: number | null;

  deletionRequestedAt?: number | null;
  deletionRequestedBy?: 'self' | 'moderator' | null;
  deletionUndoUntil?: number | null;
  purgeAfter?: number | null;
  deletedAt?: number | null;

  legalHold?: boolean;
  billingHold?: boolean;

  staffRoles?: string[] | null;
  roles?: string[] | null;
  permissions?: string[] | null;
  admin?: boolean | null;
  moderator?: boolean | null;
  superadmin?: boolean | null;
};

export function normalizeOptionalReason(reason?: string | null): string | null {
  const safe = String(reason ?? '').trim();
  return safe || null;
}

export function normalizeRequiredReason(reason?: string | null): string {
  return String(reason ?? '').trim();
}

export function normalizeNicknameForIndex(raw?: string | null): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

export function getNicknameIndexDocId(user: UserDoc): string | null {
  const normalized =
    String(user.nicknameNormalized ?? '').trim() ||
    normalizeNicknameForIndex(user.nickname);

  return normalized ? `nickname:${normalized}` : null;
}

export function buildPublicProfileSeed(user: UserDoc, uid: string, now: number) {
  return {
    uid,
    nickname: user.nickname ?? null,
    nicknameNormalized:
      String(user.nicknameNormalized ?? '').trim() ||
      normalizeNicknameForIndex(user.nickname),
    avatarUrl: user.photoURL ?? null,
    municipio: user.municipio ?? null,
    estado: user.estado ?? null,
    gender: user.gender ?? null,
    orientation: user.orientation ?? null,
    role: user.role ?? 'basic',
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

  const fromClaims = collectRolesAndPermissions((authToken ?? {}) as Record<string, unknown>);
  if (
    hasElevatedRole(fromClaims.roles) ||
    hasRequiredPermission(fromClaims.permissions, requiredPermission)
  ) {
    return;
  }

  const actorSnap = await db.collection('users').doc(actorUid).get();
  const actorData = (actorSnap.data() ?? {}) as UserDoc;

  const fromUserDoc = collectRolesAndPermissions(actorData as Record<string, unknown>);
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