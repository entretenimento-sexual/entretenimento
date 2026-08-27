// functions/src/friendship/application/manage-user-block.handler.ts
// -----------------------------------------------------------------------------
// BLOCK / UNBLOCK USER
// -----------------------------------------------------------------------------
// Estado social sensível é alterado somente no backend.
//
// Segurança e privacidade:
// - actorUid vem exclusivamente de request.auth.uid;
// - o cliente informa apenas targetUid e, no bloqueio, motivo opcional;
// - bloquear não remove histórico de chat nem outros registros probatórios;
// - novas mensagens, mídia e interações continuam barradas pelas policies
//   bilaterais já aplicadas nos respectivos domínios;
// - estado e evento de auditoria são gravados na mesma transação;
// - retries idempotentes não geram eventos duplicados;
// - bloquear/desbloquear é ação defensiva e não exige e-mail verificado.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue } from '../../firebaseApp';
import {
  resolveUserBlockTransition,
  type UserBlockAction,
} from './user-block-transition';

interface BlockUserPayload {
  targetUid?: unknown;
  reason?: unknown;
}

interface UnblockUserPayload {
  targetUid?: unknown;
}

interface UserBlockResponse {
  actorUid: string;
  targetUid: string;
  status: 'blocked' | 'unblocked';
  changed: boolean;
}

interface FriendshipUserDoc {
  uid?: unknown;
  accountStatus?: unknown;
  accountLocked?: unknown;
  loginAllowed?: unknown;
}

interface BlockStateDoc {
  isBlocked?: unknown;
}

function normalizeUid(value: unknown): string {
  const uid = String(value ?? '').trim();

  return uid && uid.length <= 128 && !uid.includes('/') ? uid : '';
}

function replaceControlCharacters(value: string): string {
  let sanitized = '';

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    sanitized += code <= 31 || code === 127 ? ' ' : value[index];
  }

  return sanitized;
}

function normalizeReason(value: unknown): string | null {
  const normalized = replaceControlCharacters(String(value ?? ''))
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return null;
  }

  if (normalized.length > 240) {
    throw new HttpsError(
      'invalid-argument',
      'O motivo do bloqueio deve ter no máximo 240 caracteres.'
    );
  }

  return normalized;
}

function assertActorCanManageBlocks(
  user: FriendshipUserDoc | undefined
): void {
  if (!user?.uid) {
    throw new HttpsError('not-found', 'Seu perfil não foi localizado.');
  }

  const accountStatus = String(user.accountStatus ?? 'active')
    .trim()
    .toLowerCase();

  if (
    accountStatus !== 'active' ||
    user.accountLocked === true ||
    user.loginAllowed === false
  ) {
    throw new HttpsError(
      'permission-denied',
      'Sua conta não está disponível para alterar bloqueios.'
    );
  }
}

function buildBlockEventId(
  actorUid: string,
  targetUid: string,
  action: UserBlockAction,
  nowMs: number
): string {
  return `${action}_${actorUid}_${targetUid}_${nowMs}`;
}

async function manageUserBlock(input: {
  actorUid: string;
  targetUid: string;
  action: UserBlockAction;
  reason?: string | null;
}): Promise<UserBlockResponse> {
  const actorRef = db.collection('users').doc(input.actorUid);
  const targetRef = db.collection('users').doc(input.targetUid);
  const blockRef = actorRef.collection('blocks').doc(input.targetUid);

  let response: UserBlockResponse | null = null;

  await db.runTransaction(async (transaction) => {
    const [actorSnapshot, targetSnapshot, blockSnapshot] = await Promise.all([
      transaction.get(actorRef),
      transaction.get(targetRef),
      transaction.get(blockRef),
    ]);

    const actor = actorSnapshot.data() as FriendshipUserDoc | undefined;
    assertActorCanManageBlocks(actor);

    if (!targetSnapshot.exists) {
      throw new HttpsError('not-found', 'Perfil de destino não encontrado.');
    }

    const currentBlock = blockSnapshot.exists
      ? blockSnapshot.data() as BlockStateDoc
      : undefined;
    const transition = resolveUserBlockTransition(
      currentBlock?.isBlocked,
      input.action
    );

    if (!transition.changed) {
      response = {
        actorUid: input.actorUid,
        targetUid: input.targetUid,
        status: transition.status,
        changed: false,
      };
      return;
    }

    const nowMs = Date.now();
    const now = FieldValue.serverTimestamp();
    const eventRef = blockRef
      .collection('events')
      .doc(buildBlockEventId(
        input.actorUid,
        input.targetUid,
        input.action,
        nowMs
      ));

    if (transition.nextIsBlocked) {
      transaction.set(blockRef, {
        uid: input.targetUid,
        isBlocked: true,
        blockedAt: now,
        unblockedAt: null,
        reason: input.reason ?? null,
        actorUid: input.actorUid,
        updatedAt: now,
      }, { merge: true });
    } else {
      transaction.set(blockRef, {
        uid: input.targetUid,
        isBlocked: false,
        unblockedAt: now,
        actorUid: input.actorUid,
        updatedAt: now,
      }, { merge: true });
    }

    transaction.create(eventRef, {
      type: input.action,
      actorUid: input.actorUid,
      targetUid: input.targetUid,
      ...(input.action === 'block' && input.reason
        ? { reason: input.reason }
        : {}),
      createdAt: now,
    });

    transaction.set(db.collection('friendship_audit').doc(), {
      action: input.action === 'block' ? 'block-user' : 'unblock-user',
      actorUid: input.actorUid,
      targetUid: input.targetUid,
      createdAt: now,
      source: 'callable',
    });

    response = {
      actorUid: input.actorUid,
      targetUid: input.targetUid,
      status: transition.status,
      changed: true,
    };
  });

  if (!response) {
    throw new HttpsError(
      'internal',
      'Não foi possível atualizar o bloqueio.'
    );
  }

  return response;
}

export const blockUser = onCall<BlockUserPayload>(
  {
    region: FUNCTIONS_REGION,
    invoker: 'public',
  },
  async (request): Promise<UserBlockResponse> => {
    const actorUid = normalizeUid(request.auth?.uid);
    const targetUid = normalizeUid(request.data?.targetUid);
    const reason = normalizeReason(request.data?.reason);

    if (!actorUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!targetUid) {
      throw new HttpsError('invalid-argument', 'Perfil de destino inválido.');
    }

    if (actorUid === targetUid) {
      throw new HttpsError(
        'invalid-argument',
        'Você não pode bloquear o próprio perfil.'
      );
    }

    return manageUserBlock({
      actorUid,
      targetUid,
      action: 'block',
      reason,
    });
  }
);

export const unblockUser = onCall<UnblockUserPayload>(
  {
    region: FUNCTIONS_REGION,
    invoker: 'public',
  },
  async (request): Promise<UserBlockResponse> => {
    const actorUid = normalizeUid(request.auth?.uid);
    const targetUid = normalizeUid(request.data?.targetUid);

    if (!actorUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!targetUid) {
      throw new HttpsError('invalid-argument', 'Perfil de destino inválido.');
    }

    if (actorUid === targetUid) {
      throw new HttpsError(
        'invalid-argument',
        'Você não pode desbloquear o próprio perfil.'
      );
    }

    return manageUserBlock({
      actorUid,
      targetUid,
      action: 'unblock',
    });
  }
);
