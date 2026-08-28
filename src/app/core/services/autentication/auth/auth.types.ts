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
    /^\/__\/auth\/action(\/|$)/.test(path) ||
    /^\/post-verification\/action(\/|$)/.test(path)
  );
};
