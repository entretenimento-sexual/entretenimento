// src/app/account/guards/account-lifecycle-status.util.ts
// -----------------------------------------------------------------------------
// Normalização compartilhada do ciclo de vida da conta.
// -----------------------------------------------------------------------------
// Motivo:
// - os guards de conta e de página de status precisam interpretar o mesmo estado
//   com a mesma regra;
// - duplicar essa lógica aumenta risco de divergência em fluxos sensíveis como
//   suspensão, exclusão pendente e conta deletada;
// - em uma rede social adulta, o bloqueio de navegação por status de conta deve
//   ser previsível, auditável e seguro por padrão.

export type LifecycleAccountStatus =
  | 'active'
  | 'self_suspended'
  | 'moderation_suspended'
  | 'pending_deletion'
  | 'deleted';

export type LifecycleAccountStatusResolution =
  | LifecycleAccountStatus
  | 'unresolved';

type AccountStatusSource = {
  accountStatus?: unknown;
  suspended?: unknown;
  suspensionSource?: unknown;
} | null;

export function normalizeAccountStatus(
  user: unknown
): LifecycleAccountStatusResolution {
  if (user === undefined) return 'unresolved';

  const account = user as AccountStatusSource;
  const raw = String(account?.accountStatus ?? '')
    .trim()
    .toLowerCase();

  if (raw === 'active') return 'active';
  if (raw === 'self_suspended') return 'self_suspended';
  if (raw === 'moderation_suspended') return 'moderation_suspended';
  if (raw === 'pending_deletion') return 'pending_deletion';
  if (raw === 'deleted') return 'deleted';

  if (account?.suspended === true) {
    return account.suspensionSource === 'self'
      ? 'self_suspended'
      : 'moderation_suspended';
  }

  /**
   * Se a leitura já resolveu e não há estado especial conhecido, a conta segue
   * como ativa. O estado `unresolved` é reservado apenas para user === undefined.
   */
  return 'active';
}

export function isRestrictedAccountStatus(
  status: LifecycleAccountStatusResolution
): boolean {
  return (
    status === 'self_suspended' ||
    status === 'moderation_suspended' ||
    status === 'pending_deletion' ||
    status === 'deleted'
  );
}
