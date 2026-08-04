import { createHash } from 'node:crypto';
import type { UserRecord } from 'firebase-admin/auth';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../../config/functions-region';
import { auth, db, FieldValue } from '../../../firebaseApp';
import type {
  VideoAudienceAuthContext,
} from '../../../media/application/video-audience-context.policy';
import {
  assertMessagingAccountOperational,
} from '../../shared/messaging-account.policy';
import type { MessagingUserDoc } from '../../shared/messaging.types';
import {
  DIRECT_MESSAGE_POLICY_VERSION,
  assertNoDirectMessagingBlock,
  normalizeDirectMessageRequestId,
  resolveDirectMessageTargetUid,
} from '../domain/direct-message.policy';
import type { DirectChatDocumentForSend } from '../domain/direct-message.policy';
import {
  normalizeRequestedPublicVideoReference,
} from '../domain/direct-message-public-video-reference.policy';
import {
  authorizeDirectVideoShareInTransaction,
} from './direct-video-share-access.service';

interface SendDirectVideoReferenceRequest {
  chatId?: unknown;
  clientRequestId?: unknown;
  publicVideoReference?: unknown;
}

interface StoredBlockDoc {
  isBlocked?: unknown;
}

interface StoredMessageDoc {
  senderId?: unknown;
  clientRequestId?: unknown;
  messageType?: unknown;
  publicVideoReference?: {
    ownerUid?: unknown;
    videoId?: unknown;
  };
}

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function isBlocked(value: StoredBlockDoc | undefined): boolean {
  return value?.isBlocked === true;
}

function resolveNickname(user: MessagingUserDoc | undefined): string {
  return clean(user?.nickname) || 'Usuário';
}

function buildMessageId(chatId: string, actorUid: string, requestId: string): string {
  const hash = createHash('sha256')
    .update(`${chatId}:${actorUid}:public-video:${requestId}`)
    .digest('hex');
  return `direct_${hash}`;
}

function assertAcceptedFriendship(actorExists: boolean, targetExists: boolean): void {
  if (!actorExists || !targetExists) {
    throw new HttpsError(
      'failed-precondition',
      'A conexão precisa estar aceita para enviar mensagens.'
    );
  }
}

function toAudienceAuthContext(user: UserRecord): VideoAudienceAuthContext {
  return {
    disabled: user.disabled === true,
    emailVerified: user.emailVerified === true,
  };
}

async function readRequiredAuthUser(uid: string): Promise<UserRecord> {
  try {
    return await auth.getUser(uid);
  } catch {
    throw new HttpsError(
      'failed-precondition',
      'Uma das contas necessárias para este compartilhamento não está disponível.'
    );
  }
}

async function readAudienceAuthContexts(
  actorUid: string,
  targetUid: string,
  ownerUid: string
): Promise<ReadonlyMap<string, VideoAudienceAuthContext>> {
  const uniqueUids = Array.from(new Set([actorUid, targetUid, ownerUid]));
  const users = await Promise.all(uniqueUids.map(readRequiredAuthUser));

  return new Map(
    users.map((user) => [user.uid, toAudienceAuthContext(user)] as const)
  );
}

export const sendDirectVideoReference = onCall<SendDirectVideoReferenceRequest>(
  { region: FUNCTIONS_REGION, invoker: 'public' },
  async (request) => {
    const actorUid = clean(request.auth?.uid);

    if (!actorUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }
    if (request.auth?.token?.email_verified !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Verifique seu e-mail antes de enviar mensagens.'
      );
    }

    const chatId = clean(request.data?.chatId);
    const clientRequestId = normalizeDirectMessageRequestId(
      request.data?.clientRequestId
    );
    const requestedReference = normalizeRequestedPublicVideoReference(
      request.data?.publicVideoReference
    );

    if (!chatId || !requestedReference) {
      throw new HttpsError('invalid-argument', 'Referência de vídeo inválida.');
    }

    const messageId = buildMessageId(chatId, actorUid, clientRequestId);
    const chatRef = db.doc(`chats/${chatId}`);
    const messageRef = chatRef.collection('messages').doc(messageId);

    // O destinatário é resolvido antes da transação apenas para carregar os
    // sinais do Firebase Auth. A conversa e o destinatário são relidos e
    // confirmados atomicamente antes de qualquer escrita.
    const preflightChatSnapshot = await chatRef.get();
    const preflightChat = preflightChatSnapshot.exists
      ? preflightChatSnapshot.data() as DirectChatDocumentForSend
      : undefined;
    const preflightTargetUid = resolveDirectMessageTargetUid(
      preflightChat,
      actorUid
    );
    const authContexts = await readAudienceAuthContexts(
      actorUid,
      preflightTargetUid,
      requestedReference.ownerUid
    );
    const actorAuth = authContexts.get(actorUid);
    const targetAuth = authContexts.get(preflightTargetUid);
    const ownerAuth = authContexts.get(requestedReference.ownerUid);

    if (!actorAuth || !targetAuth || !ownerAuth) {
      throw new HttpsError(
        'failed-precondition',
        'Não foi possível confirmar as contas deste compartilhamento.'
      );
    }

    return db.runTransaction(async (transaction) => {
      const chatSnapshot = await transaction.get(chatRef);
      const chat = chatSnapshot.exists
        ? chatSnapshot.data() as DirectChatDocumentForSend
        : undefined;
      const targetUid = resolveDirectMessageTargetUid(chat, actorUid);

      if (targetUid !== preflightTargetUid) {
        throw new HttpsError(
          'failed-precondition',
          'A conversa foi alterada. Tente compartilhar novamente.'
        );
      }

      const actorRef = db.doc(`users/${actorUid}`);
      const targetRef = db.doc(`users/${targetUid}`);
      const [
        actorSnapshot,
        targetSnapshot,
        actorBlockSnapshot,
        targetBlockSnapshot,
        actorFriendSnapshot,
        targetFriendSnapshot,
        existingMessageSnapshot,
      ] = await Promise.all([
        transaction.get(actorRef),
        transaction.get(targetRef),
        transaction.get(actorRef.collection('blocks').doc(targetUid)),
        transaction.get(targetRef.collection('blocks').doc(actorUid)),
        transaction.get(actorRef.collection('friends').doc(targetUid)),
        transaction.get(targetRef.collection('friends').doc(actorUid)),
        transaction.get(messageRef),
      ]);
      const actor = actorSnapshot.data() as MessagingUserDoc | undefined;
      const target = targetSnapshot.data() as MessagingUserDoc | undefined;

      assertMessagingAccountOperational(actor, {
        operation: 'send-direct-message',
        perspective: 'actor',
      });
      assertMessagingAccountOperational(target, {
        operation: 'send-direct-message',
        perspective: 'target',
      });
      assertNoDirectMessagingBlock({
        actorBlockedTarget: isBlocked(
          actorBlockSnapshot.data() as StoredBlockDoc | undefined
        ),
        targetBlockedActor: isBlocked(
          targetBlockSnapshot.data() as StoredBlockDoc | undefined
        ),
      });
      assertAcceptedFriendship(
        actorFriendSnapshot.exists,
        targetFriendSnapshot.exists
      );

      const storedReference = await authorizeDirectVideoShareInTransaction({
        transaction,
        actorUid,
        targetUid,
        requested: requestedReference,
        actorUser: actor,
        targetUser: target,
        actorAuth,
        targetAuth,
        ownerAuth,
      });

      if (existingMessageSnapshot.exists) {
        const existing = existingMessageSnapshot.data() as StoredMessageDoc;
        const sameReference =
          clean(existing.senderId) === actorUid &&
          clean(existing.clientRequestId) === clientRequestId &&
          existing.messageType === 'public_video' &&
          clean(existing.publicVideoReference?.ownerUid) ===
            storedReference.ownerUid &&
          clean(existing.publicVideoReference?.videoId) ===
            storedReference.videoId;

        if (sameReference) {
          return { chatId, messageId, deduplicated: true };
        }
        throw new HttpsError(
          'already-exists',
          'Não foi possível confirmar o envio solicitado.'
        );
      }

      const content = 'Vídeo compartilhado';
      const nickname = resolveNickname(actor);
      const lastMessage = {
        content,
        senderId: actorUid,
        senderUid: actorUid,
        nickname,
        timestamp: FieldValue.serverTimestamp(),
        status: 'sent',
        messageType: 'public_video',
      };

      transaction.create(messageRef, {
        ...lastMessage,
        recipientUid: targetUid,
        createdAt: FieldValue.serverTimestamp(),
        clientRequestId,
        publicVideoReference: storedReference,
        policyVersion: DIRECT_MESSAGE_POLICY_VERSION,
      });
      transaction.set(
        chatRef,
        {
          lastMessage,
          lastMessageAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return { chatId, messageId, deduplicated: false };
    });
  }
);
