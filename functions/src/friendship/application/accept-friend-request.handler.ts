// functions/src/friendship/application/accept-friend-request.handler.ts
// -----------------------------------------------------------------------------
// ACCEPT FRIEND REQUEST HANDLER
// -----------------------------------------------------------------------------
// Aceita uma solicitação de amizade/conexão.
//
// Segurança:
// - actorUid vem exclusivamente de request.auth.uid;
// - somente o target da solicitação pode aceitar;
// - cria as duas arestas bilateralmente no backend;
// - atualiza a solicitação como accepted;
// - registra auditoria;
// - notifica o solicitante quando a conexão é aceita.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { db, FieldValue } from '../../firebaseApp';
import { FUNCTIONS_REGION } from '../../config/functions-region';

interface AcceptFriendRequestPayload {
  requestId?: unknown;
}

interface AcceptFriendRequestResponse {
  requestId: string;
  requesterUid: string;
  targetUid: string;
  status: 'accepted';
}

interface FriendRequestDoc {
  requesterUid?: unknown;
  targetUid?: unknown;
  status?: unknown;
}

interface FriendshipUserDoc {
  uid?: unknown;
  nickname?: unknown;
  profileCompleted?: unknown;
  accountStatus?: unknown;
  interactionBlocked?: unknown;
  accountLocked?: unknown;
  loginAllowed?: unknown;
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function buildAcceptedNotificationId(requestId: string): string {
  return `friend_request_accepted_${requestId}`;
}

function displayNickname(user: FriendshipUserDoc | undefined): string {
  const nickname = String(user?.nickname ?? '').replace(/\s+/g, ' ').trim();
  return nickname ? nickname.slice(0, 40) : 'Seu novo contato';
}

function assertUserCanUseFriendship(
  user: FriendshipUserDoc | undefined,
  perspective: 'actor' | 'target'
): void {
  if (!user?.uid) {
    throw new HttpsError(
      perspective === 'actor' ? 'not-found' : 'failed-precondition',
      perspective === 'actor'
        ? 'Seu perfil não foi localizado.'
        : 'Este perfil não está disponível para conexão.'
    );
  }

  if (user.profileCompleted !== true) {
    throw new HttpsError(
      'failed-precondition',
      perspective === 'actor'
        ? 'Complete seu perfil antes de aceitar conexões.'
        : 'Este perfil não está disponível para conexão.'
    );
  }

  const accountStatus = String(user.accountStatus ?? 'active')
    .trim()
    .toLowerCase();

  const unavailable =
    accountStatus !== 'active' ||
    user.interactionBlocked === true ||
    user.accountLocked === true ||
    user.loginAllowed === false;

  if (unavailable) {
    throw new HttpsError(
      'permission-denied',
      perspective === 'actor'
        ? 'Sua conta não está disponível para aceitar conexões.'
        : 'Este perfil não está disponível para conexão.'
    );
  }
}

function isActiveBlock(data: FirebaseFirestore.DocumentData | undefined): boolean {
  return data?.['isBlocked'] === true;
}

export const acceptFriendRequest = onCall<AcceptFriendRequestPayload>(
  {
    region: FUNCTIONS_REGION,
    invoker: 'public',
  },
  async (request): Promise<AcceptFriendRequestResponse> => {
    const actorUid = normalizeText(request.auth?.uid);
    const requestId = normalizeText(request.data?.requestId);

    if (!actorUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (request.auth?.token?.email_verified !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Verifique seu e-mail antes de aceitar conexões.'
      );
    }

    if (!requestId) {
      throw new HttpsError('invalid-argument', 'Solicitação inválida.');
    }

    let result: AcceptFriendRequestResponse | null = null;

    await db.runTransaction(async (transaction) => {
      const requestRef = db.collection('friendRequests').doc(requestId);
      const requestSnapshot = await transaction.get(requestRef);

      if (!requestSnapshot.exists) {
        throw new HttpsError('not-found', 'Solicitação não encontrada.');
      }

      const requestDoc = requestSnapshot.data() as FriendRequestDoc;

      const requesterUid = normalizeText(requestDoc.requesterUid);
      const targetUid = normalizeText(requestDoc.targetUid);
      const status = normalizeText(requestDoc.status);

      if (!requesterUid || !targetUid) {
        throw new HttpsError(
          'data-loss',
          'Solicitação possui dados inconsistentes.'
        );
      }

      if (status !== 'pending') {
        throw new HttpsError(
          'failed-precondition',
          'Esta solicitação não está pendente.'
        );
      }

      if (actorUid !== targetUid) {
        throw new HttpsError(
          'permission-denied',
          'Somente o destinatário pode aceitar esta solicitação.'
        );
      }

      if (requesterUid === targetUid) {
        throw new HttpsError(
          'data-loss',
          'Solicitação inválida entre usuários iguais.'
        );
      }

      const requesterRef = db.collection('users').doc(requesterUid);
      const targetRef = db.collection('users').doc(targetUid);

      const requesterFriendRef = requesterRef.collection('friends').doc(targetUid);
      const targetFriendRef = targetRef.collection('friends').doc(requesterUid);

      const requesterBlockRef = requesterRef.collection('blocks').doc(targetUid);
      const targetBlockRef = targetRef.collection('blocks').doc(requesterUid);
      const notificationRef = db
        .collection('notifications')
        .doc(buildAcceptedNotificationId(requestId));

      const [
        requesterSnapshot,
        targetSnapshot,
        requesterFriendSnapshot,
        targetFriendSnapshot,
        requesterBlockSnapshot,
        targetBlockSnapshot,
      ] = await Promise.all([
        transaction.get(requesterRef),
        transaction.get(targetRef),
        transaction.get(requesterFriendRef),
        transaction.get(targetFriendRef),
        transaction.get(requesterBlockRef),
        transaction.get(targetBlockRef),
      ]);

      const requester = requesterSnapshot.data() as FriendshipUserDoc | undefined;
      const target = targetSnapshot.data() as FriendshipUserDoc | undefined;

      assertUserCanUseFriendship(target, 'actor');
      assertUserCanUseFriendship(requester, 'target');

      if (
        isActiveBlock(requesterBlockSnapshot.data()) ||
        isActiveBlock(targetBlockSnapshot.data())
      ) {
        throw new HttpsError(
          'permission-denied',
          'Não foi possível aceitar esta conexão.'
        );
      }

      const now = FieldValue.serverTimestamp();
      const targetNickname = displayNickname(target);

      transaction.set(
        requesterFriendRef,
        {
          friendUid: targetUid,
          since: now,
          lastInteractionAt: now,
          source: 'accepted-request',
          requestId,
        },
        { merge: true }
      );

      transaction.set(
        targetFriendRef,
        {
          friendUid: requesterUid,
          since: now,
          lastInteractionAt: now,
          source: 'accepted-request',
          requestId,
        },
        { merge: true }
      );

      transaction.update(requestRef, {
        status: 'accepted',
        acceptedAt: now,
        respondedAt: now,
        updatedAt: now,
      });

      transaction.set(notificationRef, {
        userId: requesterUid,
        type: 'social',
        title: 'Conexão aceita',
        body: `${targetNickname} aceitou sua solicitação de conexão.`,
        route: `/perfil/${targetUid}`,
        requestId,
        actorUid: targetUid,
        readAt: null,
        createdAt: now,
        updatedAt: now,
      }, { merge: true });

      transaction.set(db.collection('friendship_audit').doc(), {
        action: 'accept-friend-request',
        requesterUid,
        targetUid,
        acceptedBy: actorUid,
        requestId,
        createdAt: now,
        source: 'callable',
        alreadyHadRequesterEdge: requesterFriendSnapshot.exists,
        alreadyHadTargetEdge: targetFriendSnapshot.exists,
      });

      result = {
        requestId,
        requesterUid,
        targetUid,
        status: 'accepted',
      };
    });

    if (!result) {
      throw new HttpsError(
        'internal',
        'Não foi possível aceitar a solicitação.'
      );
    }

    return result;
  }
);
