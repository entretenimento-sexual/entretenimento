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


/**
 * Apenas projeção de UI; a autoridade continua nos documentos de bloqueio.
 * Desbloquear A não reabre a conversa se B ainda bloqueia A.
 */
export function isBilateralChatAvailable(
  nextActorBlocksTarget: unknown,
  targetBlocksActor: unknown
): boolean {
  return nextActorBlocksTarget !== true && targetBlocksActor !== true;
}
