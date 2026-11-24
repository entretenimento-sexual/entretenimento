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
import { assertDirectChatEmailVerified } from '../domain/direct-chat.policy';
import { normalizeDirectChatDocumentId, resolveDirectMessageTargetUid } from '../domain/direct-message.policy';
import { assertCallableAppCheck } from '../../../shared/security/callable-app-check';

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
  isRoom?: unknown;
  conversationType?: unknown;
  conversationStatus?: unknown;
  lastMessage?: {
    messageId?: unknown;
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

function resolveSenderId(message: DirectMessageForDelete | undefined): string {
  const sender = message?.senderId === undefined ? message?.senderUid : message.senderId;
  if (typeof sender !== 'string' || !sender || sender !== sender.trim() ||
      (message?.senderUid !== undefined && message.senderUid !== sender)) return '';
  return sender;
}

export const deleteDirectMessage = onCall<DeleteDirectMessageRequest>(
  {
    region: FUNCTIONS_REGION,
    invoker: 'public',
  },
  async (request): Promise<DeleteDirectMessageResponse> => {
    assertCallableAppCheck(request.app);
    const actorUid = normalizeIdentifier(request.auth?.uid);

    if (!actorUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    assertDirectChatEmailVerified(
      request.auth?.token?.email_verified, 'Verifique seu e-mail antes de apagar mensagens.'
    );

    const chatId = normalizeDirectChatDocumentId(request.data?.chatId);
    const messageId = normalizeDirectChatDocumentId(request.data?.messageId);

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

      // Validate the conversation before disclosing whether a message exists.
      const chat = chatSnapshot.data() as DirectChatForDelete | undefined;
      resolveDirectMessageTargetUid(chat, actorUid);
      if (!messageSnapshot.exists) {
        throw new HttpsError('not-found', 'Mensagem não encontrada.');
      }
      const message = messageSnapshot.data() as DirectMessageForDelete | undefined;

      if (resolveSenderId(message) !== actorUid) {
        throw new HttpsError(
          'permission-denied',
          'Você só pode apagar mensagens enviadas por você.'
        );
      }

      const deletedContent = 'Mensagem apagada';
      const lastMessage = chat?.lastMessage;
      // Exact document identity only; never guess from duplicated legacy text.
      const shouldUpdatePreview = lastMessage?.messageId === messageId;
      const stored = messageSnapshot.data()!;
      const residualFields = ['publicVideoReference', 'reactionsByUser'];
      const needsCleanup = stored.content !== deletedContent ||
        stored.messageType === 'public_video' ||
        residualFields.some(field => Object.prototype.hasOwnProperty.call(stored, field));
      const previewNeedsCleanup = shouldUpdatePreview && (
        lastMessage?.content !== deletedContent || lastMessage?.senderId !== actorUid ||
        lastMessage?.senderUid !== actorUid ||
        (lastMessage as Record<string, unknown>).deleted !== true ||
        (lastMessage as Record<string, unknown>).messageType === 'public_video' ||
        residualFields.some(field => Object.prototype.hasOwnProperty.call(lastMessage, field))
      );

      if (message?.deleted !== true || needsCleanup) {
        // update replaces maps instead of recursively merging their children.
        transaction.update(messageRef, {
          content: deletedContent,
          deleted: true,
          ...(message?.deleted === true ? {} : {
            deletedAt: FieldValue.serverTimestamp(),
            deletedBy: actorUid,
          }),
          publicVideoReference: FieldValue.delete(),
          reactionsByUser: FieldValue.delete(),
          messageType: 'text',
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      if (previewNeedsCleanup) {
        transaction.update(chatRef, {
          'lastMessage.content': deletedContent,
          'lastMessage.senderId': actorUid,
          'lastMessage.senderUid': actorUid,
          'lastMessage.deleted': true,
          'lastMessage.messageType': 'text',
          'lastMessage.publicVideoReference': FieldValue.delete(),
          'lastMessage.reactionsByUser': FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });

    return {
      chatId,
      messageId,
      deleted: true,
    };
  }
);
