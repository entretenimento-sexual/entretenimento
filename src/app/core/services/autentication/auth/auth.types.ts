//src\app\core\services\autentication\auth\auth.types.ts
export type TerminateReason =
  | 'deleted'
  | 'suspended'
  | 'auth-invalid'
  | 'doc-missing-confirmed'
  | 'forbidden';

export const inRegistrationFlow = (url: string): boolean =>
  /^\/(register(\/|$)|__\/auth\/action|post-verification\/action)/.test(url || '');
