// functions/src/friendship/application/send-friend-request.handler.ts
// -----------------------------------------------------------------------------
// SEND FRIEND REQUEST HANDLER
// -----------------------------------------------------------------------------
// Cria uma solicitação de conexão/amizade de forma segura.
//
// Segurança:
// - actorUid vem exclusivamente de request.auth.uid;
// - o cliente informa somente targetUid e mensagem opcional;
// - valida e-mail verificado;
// - valida lifecycle básico dos dois perfis;
// - impede auto-solicitação;
// - impede duplicidade pendente;
// - impede solicitação quando já existe amizade;
// - respeita bloqueios bilaterais;
// - notificação social é criada no backend para o destinatário.
// -----------------------------------------------------------------------------
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { db, FieldValue } from '../../firebaseApp';
import { FUNCTIONS_REGION } from '../../config/functions-region';

interface SendFriendRequestPayload {
  targetUid?: unknown;
  message?: unknown;
}

interface SendFriendRequestResponse {
  requestId: string;
  status: 'pending';
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

interface FriendRequestDoc {
  requesterUid?: unknown;
  targetUid?: unknown;
  status?: unknown;
}

function normalizeUid(value: unknown): string {
  return String(value ?? '').trim();
}

function buildRequestId(requesterUid: string, targetUid: string): string {
  return `${requesterUid}_${targetUid}`;
}

function buildFriendRequestNotificationId(requestId: string): string {
  return `friend_request_received_${requestId}`;
}

function displayNickname(user: FriendshipUserDoc | undefined): string {
  const nickname = String(user?.nickname ?? '').replace(/\s+/g, ' ').trim();
  return nickname ? nickname.slice(0, 40) : 'Alguém';
}

function normalizeMessage(value: unknown): string | null {
  const message = String(value ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!message) {
    return null;
  }

  if (message.length > 200) {
    throw new HttpsError(
      'invalid-argument',
      'A mensagem da solicitação deve ter no máximo 200 caracteres.'
    );
  }

  return message;
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
        ? 'Complete seu perfil antes de enviar conexões.'
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
        ? 'Sua conta não está disponível para enviar conexões.'
        : 'Este perfil não está disponível para conexão.'
    );
  }
}

function isActiveBlock(data: FirebaseFirestore.DocumentData | undefined): boolean {
  return data?.['isBlocked'] === true;
}

export const sendFriendRequest = onCall<SendFriendRequestPayload>(
  {
    region: FUNCTIONS_REGION,
    invoker: 'public',
  },
  async (request): Promise<SendFriendRequestResponse> => {
    const requesterUid = normalizeUid(request.auth?.uid);
    const targetUid = normalizeUid(request.data?.targetUid);
    const message = normalizeMessage(request.data?.message);

    if (!requesterUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (request.auth?.token?.email_verified !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Verifique seu e-mail antes de enviar conexões.'
      );
    }

    if (!targetUid) {
      throw new HttpsError('invalid-argument', 'Perfil de destino inválido.');
    }

    if (requesterUid === targetUid) {
      throw new HttpsError(
        'invalid-argument',
        'Você não pode enviar solicitação para si mesmo.'
      );
    }

    const requestId = buildRequestId(requesterUid, targetUid);

    await db.runTransaction(async (transaction) => {
      const requesterRef = db.collection('users').doc(requesterUid);
      const targetRef = db.collection('users').doc(targetUid);

      const requesterFriendRef = requesterRef.collection('friends').doc(targetUid);
      const targetFriendRef = targetRef.collection('friends').doc(requesterUid);

      const requesterBlockRef = requesterRef.collection('blocks').doc(targetUid);
      const targetBlockRef = targetRef.collection('blocks').doc(requesterUid);

      const requestRef = db.collection('friendRequests').doc(requestId);
      const reverseRequestRef = db
        .collection('friendRequests')
        .doc(buildRequestId(targetUid, requesterUid));
      const notificationRef = db
        .collection('notifications')
        .doc(buildFriendRequestNotificationId(requestId));

      const [
        requesterSnapshot,
        targetSnapshot,
        requesterFriendSnapshot,
        targetFriendSnapshot,
        requesterBlockSnapshot,
        targetBlockSnapshot,
        requestSnapshot,
        reverseRequestSnapshot,
      ] = await Promise.all([
        transaction.get(requesterRef),
        transaction.get(targetRef),
        transaction.get(requesterFriendRef),
        transaction.get(targetFriendRef),
        transaction.get(requesterBlockRef),
        transaction.get(targetBlockRef),
        transaction.get(requestRef),
        transaction.get(reverseRequestRef),
      ]);

      const requester = requesterSnapshot.data() as FriendshipUserDoc | undefined;
      const target = targetSnapshot.data() as FriendshipUserDoc | undefined;

      assertUserCanUseFriendship(requester, 'actor');
      assertUserCanUseFriendship(target, 'target');

      if (requesterFriendSnapshot.exists || targetFriendSnapshot.exists) {
        throw new HttpsError('already-exists', 'Vocês já estão conectados.');
      }

      if (
        isActiveBlock(requesterBlockSnapshot.data()) ||
        isActiveBlock(targetBlockSnapshot.data())
      ) {
        throw new HttpsError(
          'permission-denied',
          'Não foi possível enviar esta conexão.'
        );
      }

      const existingRequest = requestSnapshot.data() as
        | FriendRequestDoc
        | undefined;

      if (requestSnapshot.exists && existingRequest?.status === 'pending') {
        throw new HttpsError(
          'already-exists',
          'Já existe uma solicitação pendente para este perfil.'
        );
      }

      const reverseRequest = reverseRequestSnapshot.data() as
        | FriendRequestDoc
        | undefined;

      if (
        reverseRequestSnapshot.exists &&
        reverseRequest?.status === 'pending'
      ) {
        throw new HttpsError(
          'failed-precondition',
          'Este perfil já enviou uma solicitação para você. Revise seus convites.'
        );
      }

      const now = FieldValue.serverTimestamp();
      const requesterNickname = displayNickname(requester);

      transaction.set(requestRef, {
        requesterUid,
        targetUid,
        message,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        policyVersion: 1,
        source: 'callable',
      });

      transaction.set(notificationRef, {
        userId: targetUid,
        type: 'social',
        title: 'Nova solicitação de conexão',
        body: `${requesterNickname} quer se conectar com você.`,
        route: '/chat/invite-list',
        requestId,
        actorUid: requesterUid,
        readAt: null,
        createdAt: now,
        updatedAt: now,
      }, { merge: true });

      transaction.set(db.collection('friendship_audit').doc(), {
        action: 'send-friend-request',
        requesterUid,
        targetUid,
        requestId,
        createdAt: now,
        source: 'callable',
      });
    });

    return {
      requestId,
      status: 'pending',
    };
  }
);
