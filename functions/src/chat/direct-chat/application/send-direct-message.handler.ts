// functions/src/chat/direct-chat/application/send-direct-message.handler.ts
// -----------------------------------------------------------------------------
// SEND DIRECT MESSAGE HANDLER
// -----------------------------------------------------------------------------
// Envia mensagem em conversa direta existente.
//
// Papel desta callable:
// - o cliente informa somente `chatId`, `content` e `clientRequestId`;
// - actorUid vem exclusivamente de `request.auth.uid`;
// - conteúdo é validado no backend;
// - o usuário precisa participar da conversa;
// - lifecycle dos dois perfis é validado no momento do envio;
// - bloqueio bilateral impede nova mensagem;
// - amizade/conexão bilateral ativa é obrigatória para enviar;
// - mensagem e preview do chat são gravados em transação;
// - clientRequestId torna retry idempotente.
//
// Segurança digital:
// - histórico antigo não equivale a autorização permanente de contato;
// - se a conexão for removida, o histórico pode existir, mas nova mensagem
//   passa a ser bloqueada;
// - amizade unilateral não libera envio;
// - bloqueio bilateral continua tendo prioridade de proteção;
// - o cliente não escreve diretamente em `/chats/{chatId}/messages`.
//
// Expansão futura:
// - compatível com app mobile usando a mesma callable;
// - base pronta para unread counters, push notification, rate limit,
//   antiflood, denúncia e moderação;
// - clientRequestId evita duplicidade por retry em redes móveis instáveis.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  assertPlatformAccountAccessData,
} from '../../../account_lifecycle/interaction-access.policy';
import { db, FieldValue } from '../../../firebaseApp';
import { assertCallableAppCheck } from '../../../shared/security/callable-app-check';
import { FUNCTIONS_REGION } from '../../../config/functions-region';

import {
  assertMessagingAccountOperational,
} from '../../shared/messaging-account.policy';

import type {
  MessagingUserDoc,
} from '../../shared/messaging.types';

import {
  DIRECT_MESSAGE_POLICY_VERSION,
  assertNoDirectMessagingBlock,
  normalizeDirectMessageContent,
  normalizeDirectMessageRequestId,
  resolveDirectMessageTargetUid,
} from '../domain/direct-message.policy';

import type {
  DirectChatDocumentForSend,
} from '../domain/direct-message.policy';

interface SendDirectMessageRequest {
  chatId?: unknown;
  content?: unknown;
  clientRequestId?: unknown;
}

interface SendDirectMessageResponse {
  chatId: string;
  messageId: string;
  deduplicated: boolean;
}

interface StoredDirectMessageDoc {
  senderId?: unknown;
  content?: unknown;
  clientRequestId?: unknown;
}

interface StoredBlockDoc {
  isBlocked?: unknown;
}

function normalizeIdentifier(value: unknown): string {
  return String(value ?? '').trim();
}

function buildMessageId(
  chatId: string,
  actorUid: string,
  clientRequestId: string
): string {
  const seed = `${chatId}:${actorUid}:${clientRequestId}`;
  const hash = createHash('sha256').update(seed).digest('hex');

  return `direct_${hash}`;
}

function resolveNickname(user: MessagingUserDoc | undefined): string {
  return String(user?.nickname ?? '').trim() || 'Usuário';
}

function isBlocked(block: StoredBlockDoc | undefined): boolean {
  return block?.isBlocked === true;
}

/**
 * Validação de consentimento social para envio de mensagem.
 *
 * A existência de chat não basta.
 * Para nova mensagem, a conexão precisa estar aceita dos dois lados:
 *
 * /users/{actorUid}/friends/{targetUid}
 * /users/{targetUid}/friends/{actorUid}
 */
function assertAcceptedFriendshipForDirectMessage(params: {
  actorFriendExists: boolean;
  targetFriendExists: boolean;
}): void {
  if (!params.actorFriendExists || !params.targetFriendExists) {
    throw new HttpsError(
      'failed-precondition',
      'A conexão precisa estar aceita para enviar mensagens.'
    );
  }
}

function isSameIdempotentMessage(
  message: StoredDirectMessageDoc | undefined,
  actorUid: string,
  content: string,
  clientRequestId: string
): boolean {
  return (
    normalizeIdentifier(message?.senderId) === actorUid &&
    String(message?.content ?? '') === content &&
    normalizeIdentifier(message?.clientRequestId) === clientRequestId
  );
}

async function assertDirectMessageParticipantAccess(
  transaction: Transaction,
  actorRef: DocumentReference,
  targetRef: DocumentReference
): Promise<MessagingUserDoc | undefined> {
  const [actorSnapshot, targetSnapshot, actorBlock, targetBlock, actorFriend, targetFriend] =
    await transaction.getAll(
      actorRef,
      targetRef,
      actorRef.collection('blocks').doc(targetRef.id),
      targetRef.collection('blocks').doc(actorRef.id),
      actorRef.collection('friends').doc(targetRef.id),
      targetRef.collection('friends').doc(actorRef.id)
    );

  const actor = actorSnapshot.data() as MessagingUserDoc | undefined;
  const target = targetSnapshot.data() as MessagingUserDoc | undefined;
  assertMessagingAccountOperational(actor, { operation: 'send-direct-message', perspective: 'actor' });
  assertMessagingAccountOperational(target, { operation: 'send-direct-message', perspective: 'target' });
  assertPlatformAccountAccessData(actor);
  assertPlatformAccountAccessData(target);
  assertNoDirectMessagingBlock({
    actorBlockedTarget: isBlocked(actorBlock.data()),
    targetBlockedActor: isBlocked(targetBlock.data()),
  });
  assertAcceptedFriendshipForDirectMessage({
    actorFriendExists: actorFriend.exists,
    targetFriendExists: targetFriend.exists,
  });
  return actor;
}

const CONVERSATION_PACES = ['talk_first', 'take_it_slow', 'open_to_meeting'] as const;
type ConversationPace = typeof CONVERSATION_PACES[number];

export const getDirectConversationStarter = onCall<{ chatId?: unknown }>(
  { region: FUNCTIONS_REGION, invoker: 'public' },
  async (request): Promise<{ pace: ConversationPace | null }> => {
    assertCallableAppCheck(request.app);
    const actorUid = request.auth?.uid;
    if (!actorUid) throw new HttpsError('unauthenticated', 'Entre para abrir a conversa.');
    if (request.auth?.token.email_verified !== true) {
      throw new HttpsError('failed-precondition', 'Confirme seu e-mail para conversar.');
    }
    const chatId = normalizeIdentifier(request.data?.chatId);
    if (!chatId || chatId.includes('/') || chatId === '.' || chatId === '..' || chatId.length > 256) {
      throw new HttpsError('invalid-argument', 'Conversa não identificada.');
    }

    return db.runTransaction(async (transaction) => {
      const chat = await transaction.get(db.collection('chats').doc(chatId));
      const targetUid = resolveDirectMessageTargetUid(chat.data(), actorUid);
      const actorRef = db.collection('users').doc(actorUid);
      const targetRef = db.collection('users').doc(targetUid);
      await assertDirectMessageParticipantAccess(transaction, actorRef, targetRef);
      const [actorPreferences, targetPreferences] = await transaction.getAll(
        actorRef.collection('preferences').doc('profile'),
        targetRef.collection('preferences').doc('profile')
      );

      // Um resultado vazio não revela escolhas individuais nem quem autorizou.
      const pace = CONVERSATION_PACES.find((value) => value === actorPreferences.get('conversationPace'));
      const mutual = pace && pace === targetPreferences.get('conversationPace') &&
        actorPreferences.get('visibility.shareConversationPace') === true &&
        targetPreferences.get('visibility.shareConversationPace') === true;
      return { pace: mutual ? pace : null };
    }, { readOnly: true });
  }
);

export const sendDirectMessage = onCall<SendDirectMessageRequest>(
  {
    region: FUNCTIONS_REGION,
    invoker: 'public',
  },
  async (request): Promise<SendDirectMessageResponse> => {
    const actorUid = normalizeIdentifier(request.auth?.uid);

    if (!actorUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (request.auth?.token?.email_verified !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Verifique seu e-mail antes de enviar mensagens.'
      );
    }

    const chatId = normalizeIdentifier(request.data?.chatId);

    if (!chatId) {
      throw new HttpsError(
        'invalid-argument',
        'Conversa não identificada.'
      );
    }

    const content = normalizeDirectMessageContent(request.data?.content);
    const clientRequestId = normalizeDirectMessageRequestId(
      request.data?.clientRequestId
    );

    const messageId = buildMessageId(chatId, actorUid, clientRequestId);

    const chatRef = db.collection('chats').doc(chatId);
    const messageRef = chatRef.collection('messages').doc(messageId);

    return db.runTransaction(async (transaction) => {
      const chatSnapshot = await transaction.get(chatRef);

      const chat = chatSnapshot.exists
        ? chatSnapshot.data() as DirectChatDocumentForSend
        : undefined;

      /**
       * Esta função deve validar:
       * - se o chat existe;
       * - se actorUid participa;
       * - quem é o outro participante.
       *
       * Se o cliente informar um chat que não pertence a ele, a policy deve
       * lançar erro. O cliente nunca deve conseguir forçar targetUid.
       */
      const targetUid = resolveDirectMessageTargetUid(chat, actorUid);

      const actorRef = db.collection('users').doc(actorUid);
      const targetRef = db.collection('users').doc(targetUid);

      const [actor, existingMessageSnapshot] = await Promise.all([
        assertDirectMessageParticipantAccess(transaction, actorRef, targetRef),
        transaction.get(messageRef),
      ]);

      /**
       * Idempotência.
       *
       * Em mobile e redes instáveis, o usuário pode reenviar a mesma intenção
       * por retry. Se `clientRequestId` e conteúdo forem iguais, retornamos o
       * mesmo messageId sem criar duplicidade.
       */
      if (existingMessageSnapshot.exists) {
        const existingMessage =
          existingMessageSnapshot.data() as StoredDirectMessageDoc;

        if (
          isSameIdempotentMessage(
            existingMessage,
            actorUid,
            content,
            clientRequestId
          )
        ) {
          return {
            chatId,
            messageId,
            deduplicated: true,
          };
        }

        throw new HttpsError(
          'already-exists',
          'Não foi possível confirmar o envio solicitado.'
        );
      }

      const nickname = resolveNickname(actor);

      const lastMessage = {
        messageId,
        content,
        senderId: actorUid,
        senderUid: actorUid,
        nickname,
        timestamp: FieldValue.serverTimestamp(),
        status: 'sent',
      };

      transaction.create(messageRef, {
        ...lastMessage,
        recipientUid: targetUid,
        createdAt: FieldValue.serverTimestamp(),
        clientRequestId,
        messageType: 'text',
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

      return {
        chatId,
        messageId,
        deduplicated: false,
      };
    });
  }
);
