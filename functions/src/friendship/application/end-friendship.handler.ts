// functions/src/friendship/application/end-friendship.handler.ts
// -----------------------------------------------------------------------------
// END FRIENDSHIP HANDLER
// -----------------------------------------------------------------------------
// Desfaz uma amizade/conexão de forma segura.
//
// Segurança:
// - actorUid vem exclusivamente de request.auth.uid;
// - o cliente informa somente friendUid;
// - remove as duas arestas da amizade em transaction;
// - não apaga histórico de chat;
// - a remoção das arestas já bloqueia novas mensagens, porque o chat direto
//   agora exige amizade bilateral;
// - registra auditoria para rastreabilidade.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { db, FieldValue } from '../../firebaseApp';
import { FUNCTIONS_REGION } from '../../config/functions-region';

interface EndFriendshipPayload {
  friendUid?: unknown;
}

interface EndFriendshipResponse {
  actorUid: string;
  friendUid: string;
  status: 'ended';
}

interface FriendshipUserDoc {
  uid?: unknown;
  accountStatus?: unknown;
  interactionBlocked?: unknown;
  accountLocked?: unknown;
  loginAllowed?: unknown;
}

function normalizeUid(value: unknown): string {
  return String(value ?? '').trim();
}

/**
 * Para desfazer amizade, a regra deve ser menos rígida que para iniciar contato.
 *
 * Motivo:
 * - encerrar uma conexão é ação de segurança e privacidade;
 * - o usuário precisa conseguir sair de uma relação social mesmo que o outro
 *   perfil esteja suspenso, incompleto ou indisponível;
 * - exigimos apenas autenticação, e-mail verificado e documento básico do ator.
 */
function assertActorCanEndFriendship(user: FriendshipUserDoc | undefined): void {
  if (!user?.uid) {
    throw new HttpsError('not-found', 'Seu perfil não foi localizado.');
  }

  const accountStatus = String(user.accountStatus ?? 'active')
    .trim()
    .toLowerCase();

  const loginBlocked =
    accountStatus !== 'active' ||
    user.accountLocked === true ||
    user.loginAllowed === false;

  if (loginBlocked) {
    throw new HttpsError(
      'permission-denied',
      'Sua conta não está disponível para alterar conexões.'
    );
  }
}

export const endFriendship = onCall<EndFriendshipPayload>(
  {
    region: FUNCTIONS_REGION,
    invoker: 'public',
  },
  async (request): Promise<EndFriendshipResponse> => {
    const actorUid = normalizeUid(request.auth?.uid);
    const friendUid = normalizeUid(request.data?.friendUid);

    if (!actorUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (request.auth?.token?.email_verified !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Verifique seu e-mail antes de alterar conexões.'
      );
    }

    if (!friendUid) {
      throw new HttpsError('invalid-argument', 'Perfil de amizade inválido.');
    }

    if (actorUid === friendUid) {
      throw new HttpsError(
        'invalid-argument',
        'Você não pode desfazer amizade consigo mesmo.'
      );
    }

    let result: EndFriendshipResponse | null = null;

    await db.runTransaction(async (transaction) => {
      const actorRef = db.collection('users').doc(actorUid);
      const friendRef = db.collection('users').doc(friendUid);

      const actorFriendRef = actorRef.collection('friends').doc(friendUid);
      const friendActorRef = friendRef.collection('friends').doc(actorUid);

      const [
        actorSnapshot,
        actorFriendSnapshot,
        friendActorSnapshot,
      ] = await Promise.all([
        transaction.get(actorRef),
        transaction.get(actorFriendRef),
        transaction.get(friendActorRef),
      ]);

      const actor = actorSnapshot.data() as FriendshipUserDoc | undefined;

      assertActorCanEndFriendship(actor);

      if (!actorFriendSnapshot.exists && !friendActorSnapshot.exists) {
        throw new HttpsError(
          'failed-precondition',
          'Vocês não estão conectados.'
        );
      }

      const now = FieldValue.serverTimestamp();

      if (actorFriendSnapshot.exists) {
        transaction.delete(actorFriendRef);
      }

      if (friendActorSnapshot.exists) {
        transaction.delete(friendActorRef);
      }

      transaction.set(db.collection('friendship_audit').doc(), {
        action: 'end-friendship',
        actorUid,
        friendUid,
        createdAt: now,
        source: 'callable',
        removedActorEdge: actorFriendSnapshot.exists,
        removedFriendEdge: friendActorSnapshot.exists,
      });

      result = {
        actorUid,
        friendUid,
        status: 'ended',
      };
    });

    if (!result) {
      throw new HttpsError('internal', 'Não foi possível desfazer a amizade.');
    }

    return result;
  }
);