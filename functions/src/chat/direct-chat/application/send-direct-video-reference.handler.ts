import { createHash } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../../config/functions-region';
import { db, FieldValue } from '../../../firebaseApp';
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
  resolveStoredDirectMessagePublicVideoReference,
} from '../domain/direct-message-public-video-reference.policy';

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

    return db.runTransaction(async (transaction) => {
      const chatSnapshot = await transaction.get(chatRef);
      const chat = chatSnapshot.exists
        ? chatSnapshot.data() as DirectChatDocumentForSend
        : undefined;
      const targetUid = resolveDirectMessageTargetUid(chat, actorUid);

      const actorRef = db.doc(`users/${actorUid}`);
      const targetRef = db.doc(`users/${targetUid}`);
      const publicProfileRef = db.doc(
        `public_profiles/${requestedReference.ownerUid}`
      );
      const publicVideoRef = publicProfileRef
        .collection('public_videos')
        .doc(requestedReference.videoId);
      const publicationRef = db.doc(
        `users/${requestedReference.ownerUid}/video_publications/${requestedReference.videoId}`
      );

      const [
        actorSnapshot,
        targetSnapshot,
        actorBlockSnapshot,
        targetBlockSnapshot,
        actorFriendSnapshot,
        targetFriendSnapshot,
        publicProfileSnapshot,
        publicVideoSnapshot,
        publicationSnapshot,
        existingMessageSnapshot,
      ] = await Promise.all([
        transaction.get(actorRef),
        transaction.get(targetRef),
        transaction.get(actorRef.collection('blocks').doc(targetUid)),
        transaction.get(targetRef.collection('blocks').doc(actorUid)),
        transaction.get(actorRef.collection('friends').doc(targetUid)),
        transaction.get(targetRef.collection('friends').doc(actorUid)),
        transaction.get(publicProfileRef),
        transaction.get(publicVideoRef),
        transaction.get(publicationRef),
        transaction.get(messageRef),
      ]);

      const actor = actorSnapshot.data() as MessagingUserDoc | undefined;
      const target = targetSnapshot.data() as MessagingUserDoc | undefined;

      assertMessagingAccountOperational(actor, {
        operation: 'send-direct-video-reference',
        perspective: 'actor',
      });
      assertMessagingAccountOperational(target, {
        operation: 'send-direct-video-reference',
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

      const storedReference =
        resolveStoredDirectMessagePublicVideoReference({
          requested: requestedReference,
          publicProfileExists: publicProfileSnapshot.exists,
          publicVideo: publicVideoSnapshot.exists
            ? publicVideoSnapshot.data()
            : undefined,
          publication: publicationSnapshot.exists
            ? publicationSnapshot.data()
            : undefined,
        });

      if (!storedReference) {
        throw new HttpsError(
          'failed-precondition',
          'Este vídeo não está disponível para compartilhamento.'
        );
      }

      if (existingMessageSnapshot.exists) {
        const existing = existingMessageSnapshot.data() as StoredMessageDoc;
        const sameReference =
          clean(existing.senderId) === actorUid &&
          clean(existing.clientRequestId) === clientRequestId &&
          existing.messageType === 'public_video' &&
          clean(existing.publicVideoReference?.ownerUid) === storedReference.ownerUid &&
          clean(existing.publicVideoReference?.videoId) === storedReference.videoId;

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
