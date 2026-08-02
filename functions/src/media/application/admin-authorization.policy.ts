import { HttpsError } from 'firebase-functions/v2/https';

export type AdminClaimSource = 'admin' | 'role' | 'roles';

export interface AdminAuthorizationSnapshot {
  readonly adminUid: string;
  readonly allowed: boolean;
  readonly source: AdminClaimSource | null;
}

interface CallableAuthLike {
  readonly uid?: unknown;
  readonly token?: unknown;
}

function cleanAdminUid(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function normalizeRole(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase()
    : '';
}

function authToken(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
    ? value as Readonly<Record<string, unknown>>
    : {};
}

/**
 * Resolve claims administrativas sem confiar em coerção booleana ou valores
 * não textuais. A plataforma aceita exclusivamente os formatos já usados:
 * `admin: true`, `role: 'admin'` ou `roles: ['admin']`.
 */
export function resolveAdminAuthorization(
  requestAuth: unknown
): AdminAuthorizationSnapshot {
  const auth = requestAuth as CallableAuthLike | null | undefined;
  const adminUid = cleanAdminUid(auth?.uid);
  const token = authToken(auth?.token);

  if (token['admin'] === true) {
    return { adminUid, allowed: true, source: 'admin' };
  }

  if (normalizeRole(token['role']) === 'admin') {
    return { adminUid, allowed: true, source: 'role' };
  }

  const roles = Array.isArray(token['roles'])
    ? token['roles'].map(normalizeRole)
    : [];

  if (roles.includes('admin')) {
    return { adminUid, allowed: true, source: 'roles' };
  }

  return { adminUid, allowed: false, source: null };
}

/**
 * Autoriza uma operação administrativa e devolve o UID já normalizado.
 * A mensagem de permissão permanece específica do domínio chamador.
 */
export function assertAdminAuthorization(
  requestAuth: unknown,
  permissionMessage: string
): string {
  const authorization = resolveAdminAuthorization(requestAuth);

  if (!authorization.adminUid) {
    throw new HttpsError('unauthenticated', 'Administrador não autenticado.');
  }

  if (!authorization.allowed) {
    throw new HttpsError(
      'permission-denied',
      String(permissionMessage ?? '').trim() ||
        'Apenas administradores podem concluir esta ação.'
    );
  }

  return authorization.adminUid;
}
