// functions/src/chat/direct-chat/application/delete-direct-message.handler.ts
// -----------------------------------------------------------------------------
// DELETE DIRECT MESSAGE HANDLER
// -----------------------------------------------------------------------------
// Apaga uma mensagem direta de forma lógica, validada no backend.
//
// Decisão:
// - cliente NÃO pode excluir fisicamente documentos de mensagem;
// - a mensagem é marcada como apagada;
// - somente o autor pode apagar a própria mensagem;
// - o histórico permanece consistente para os dois participantes;
// - se a mensagem apagada era o preview do chat, o preview é atualizado.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { db, FieldValue } from '../../../firebaseApp';
import { FUNCTIONS_REGION } from '../../../config/functions-region';

interface DeleteDirectMessageRequest {
  chatId?: unknown;
  messageId?: unknown;
}

interface DeleteDirectMessageResponse {
  chatId: string;
  messageId: string;
  deleted: true;
}

interface DirectChatForDelete {
  participants?: unknown;
  lastMessage?: {
    content?: unknown;
    senderId?: unknown;
    senderUid?: unknown;
  };
}

interface DirectMessageForDelete {
  senderId?: unknown;
  senderUid?: unknown;
  deleted?: unknown;
}

function normalizeIdentifier(value: unknown): string {
  return String(value ?? '').trim();
}

function resolveParticipants(chat: DirectChatForDelete | undefined): string[] {
  return Array.isArray(chat?.participants)
    ? chat.participants.map((value) => normalizeIdentifier(value)).filter(Boolean)
    : [];
}

function resolveSenderId(message: DirectMessageForDelete | undefined): string {
  return normalizeIdentifier(message?.senderId) || normalizeIdentifier(message?.senderUid);
}

export const deleteDirectMessage = onCall<DeleteDirectMessageRequest>(
  {
    region: FUNCTIONS_REGION,
    invoker: 'public',
  },
  async (request): Promise<DeleteDirectMessageResponse> => {
    const actorUid = normalizeIdentifier(request.auth?.uid);

    if (!actorUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (request.auth?.token?.email_verified !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Verifique seu e-mail antes de apagar mensagens.'
      );
    }

    const chatId = normalizeIdentifier(request.data?.chatId);
    const messageId = normalizeIdentifier(request.data?.messageId);

    if (!chatId || !messageId) {
      throw new HttpsError('invalid-argument', 'Mensagem não identificada.');
    }

    const chatRef = db.collection('chats').doc(chatId);
    const messageRef = chatRef.collection('messages').doc(messageId);

    await db.runTransaction(async (transaction) => {
      const [chatSnapshot, messageSnapshot] = await Promise.all([
        transaction.get(chatRef),
        transaction.get(messageRef),
      ]);

      if (!chatSnapshot.exists) {
        throw new HttpsError('not-found', 'Conversa não encontrada.');
      }

      if (!messageSnapshot.exists) {
        throw new HttpsError('not-found', 'Mensagem não encontrada.');
      }

      const chat = chatSnapshot.data() as DirectChatForDelete | undefined;
      const message = messageSnapshot.data() as DirectMessageForDelete | undefined;
      const participants = resolveParticipants(chat);

      if (!participants.includes(actorUid)) {
        throw new HttpsError('permission-denied', 'Você não participa desta conversa.');
      }

      if (resolveSenderId(message) !== actorUid) {
        throw new HttpsError(
          'permission-denied',
          'Você só pode apagar mensagens enviadas por você.'
        );
      }

      if (message?.deleted === true) {
        return;
      }

      const deletedContent = 'Mensagem apagada';

      transaction.set(
        messageRef,
        {
          content: deletedContent,
          deleted: true,
          deletedAt: FieldValue.serverTimestamp(),
          deletedBy: actorUid,
          reactionsByUser: {},
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      const lastMessage = chat?.lastMessage;
      const lastMessageSender = normalizeIdentifier(lastMessage?.senderId)
        || normalizeIdentifier(lastMessage?.senderUid);
      const shouldUpdatePreview = lastMessageSender === actorUid
        && normalizeIdentifier(lastMessage?.content) === normalizeIdentifier(
          (messageSnapshot.data() as { content?: unknown } | undefined)?.content
        );

      if (shouldUpdatePreview) {
        transaction.set(
          chatRef,
          {
            lastMessage: {
              ...(lastMessage ?? {}),
              content: deletedContent,
              senderId: actorUid,
              senderUid: actorUid,
              timestamp: FieldValue.serverTimestamp(),
              deleted: true,
            },
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    });

    return {
      chatId,
      messageId,
      deleted: true,
    };
  }
);
