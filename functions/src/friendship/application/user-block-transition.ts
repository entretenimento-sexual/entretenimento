export type UserBlockAction = 'block' | 'unblock';

export interface UserBlockTransition {
  readonly changed: boolean;
  readonly nextIsBlocked: boolean;
  readonly status: 'blocked' | 'unblocked';
}

/**
 * Resolve a transição de forma idempotente antes de qualquer escrita.
 * Repetir block/unblock no mesmo estado não produz nova auditoria.
 */
export function resolveUserBlockTransition(
  currentIsBlocked: unknown,
  action: UserBlockAction
): UserBlockTransition {
  const currentlyBlocked = currentIsBlocked === true;
  const nextIsBlocked = action === 'block';

  return {
    changed: currentlyBlocked !== nextIsBlocked,
    nextIsBlocked,
    status: nextIsBlocked
      ? 'blocked'
      : 'unblocked',
  };
}
