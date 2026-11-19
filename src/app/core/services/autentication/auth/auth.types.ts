// src/app/core/services/autentication/auth/auth.types.ts
export type TerminateReason =
  | 'deleted'
  | 'suspended'
  | 'auth-invalid'
  | 'doc-missing-confirmed'
  | 'forbidden';

/**
 * Fonte única: normaliza URL -> path (remove ?query e #hash)
 */
export const normalizePath = (url: string | null | undefined): string => {
  const raw = (url ?? '').trim();
  if (!raw) return '/';
  return raw.split('?')[0].split('#')[0] || '/';
};

export function isPublicLegalDocument(url: string | null): boolean {
  const path = normalizePath(url).replace(/;[^/]*|\/$/g, '');
  return path === '/termos-e-condicoes' ||
    path === '/politica-de-privacidade' ||
    path === '/politica-de-cookies';
}

/**
 * Fonte única: define rotas sensíveis (registro/login/ações de auth).
 * - Inclui /login
 * - Normaliza internamente (query/hash)
 */
export const inRegistrationFlow = (url: string): boolean => {
  const path = normalizePath(url);

  return (
    /^\/register(\/|$)/.test(path) ||
    /^\/login(\/|$)/.test(path) ||
    path === '/adulto/verificar-idade' ||
    /^\/__\/auth\/action(\/|$)/.test(path) ||
    /^\/post-verification\/action(\/|$)/.test(path)
  );
};

export type SessionEndReason = 'session-ended' | 'session-expired' | 'session-disabled';

export function authInvalidationReason(error: unknown): SessionEndReason | null {
  const code = (error as { code?: unknown } | null)?.code;
  switch (code) {
    case 'auth/user-disabled':
      return 'session-disabled';
    case 'auth/user-not-found':
    case 'auth/user-token-expired':
    case 'auth/invalid-user-token':
      return 'session-expired';
    default:
      return null;
  }
}

export function isSessionEndReason(value: unknown): value is SessionEndReason {
  return value === 'session-ended' || value === 'session-expired' || value === 'session-disabled';
}
