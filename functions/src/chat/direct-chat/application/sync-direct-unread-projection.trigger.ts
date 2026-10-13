/**
 * Projeção experimental de não lidas, backend-only.
 * Não é consumida pelo badge até backfill/reconciliação e validação.
 *
 * A transação usa o estado ATUAL da mensagem, não a ordem de chegada dos
 * eventos, e mantém um checkpoint por mensagem. Entregas duplicadas e fora
 * de ordem convergem para o mesmo total. Não armazena texto privado.
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db, FieldValue } from '../../../firebaseApp';
import { FUNCTIONS_REGION } from '../../../config/functions-region';
import {
  applyDirectUnreadTransition,
  type DirectUnreadMessage,
  type DirectReceiptStatus,
} from '../domain/direct-unread-projection.policy';
import { DIRECT_UNREAD_MAX_TRANSACTION_ATTEMPTS } from '../domain/direct-unread-backfill-budget.policy';

const validStatuses = new Set<DirectReceiptStatus>(['sent', 'delivered', 'read']);

function readMessage(id: string, data: FirebaseFirestore.DocumentData | undefined):
  DirectUnreadMessage | null {
  if (!data) return null;
  const senderUid = String(data.senderId ?? data.senderUid ?? '').trim();
  const status = data.status;
  if (!senderUid || !validStatuses.has(status as DirectReceiptStatus)) return null;
  return { messageId: id, senderUid, status: status as DirectReceiptStatus, deleted: data.deleted === true };
}

/** Callable internally by emulator tests and future bounded backfill. */
async function reconcileDirectUnreadMessageInternal(
  chatId: string,
  messageId: string,
  expectedParticipants?: readonly string[],
  expectedMessageIds?: readonly string[],
  onReadForEmulatorTest?: () => Promise<void>
): Promise<void> {
  const chatRef = db.collection('chats').doc(chatId);
  const messageRef = chatRef.collection('messages').doc(messageId);

  await db.runTransaction(async (tx) => {
    const [chat, message] = await Promise.all([tx.get(chatRef), tx.get(messageRef)]);
    const participants: unknown = chat.data()?.participants;
    if (!Array.isArray(participants) || participants.length !== 2 ||
        participants.some((uid) => typeof uid !== 'string' || !uid.trim()) ||
        participants[0] === participants[1]) return;
    if (expectedParticipants && (
      participants.length !== expectedParticipants.length ||
      participants.some((uid) => !expectedParticipants.includes(uid))
    )) throw new Error('Unread backfill participants changed');
    if (expectedMessageIds) {
      const messages = await tx.get(chatRef.collection('messages')
        .orderBy('__name__').limit(101));
      if (messages.size !== expectedMessageIds.length ||
          messages.docs.some((doc, index) => doc.id !== expectedMessageIds[index])) {
        throw new Error('Unread backfill message set changed in transaction');
      }
    }
    const current = readMessage(messageId, message.data());
    if (current && !participants.includes(current.senderUid)) return;

    // Keep projections per participant. Reads precede all writes.
    const entries = (participants as string[]).map((uid) => {
      const projectionRef = db.collection('direct_chat_unread_projections')
        .doc(uid).collection('chats').doc(chatId);
      const checkpointRef = projectionRef.collection('messages').doc(messageId);
      return { uid, projectionRef, checkpointRef };
    });
    const snapshots = await Promise.all(entries.map(async (entry) => ({
      projection: await tx.get(entry.projectionRef),
      checkpoint: await tx.get(entry.checkpointRef),
    })));

    if (onReadForEmulatorTest) {
      if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Test hook requires emulator');
      await onReadForEmulatorTest();
    }

    entries.forEach((entry, index) => {
      const snapshotsForUser = snapshots[index];
      const previous = readMessage(messageId, snapshotsForUser.checkpoint.data());
      const priorCount = snapshotsForUser.projection.exists
        ? snapshotsForUser.projection.data()?.unreadCount : 0;
      // Invalid projection is not silently repaired by a delta.
      if (!Number.isSafeInteger(priorCount) || priorCount < 0) {
        throw new Error('Invalid direct unread projection count');
      }
      const nextCount = applyDirectUnreadTransition(priorCount, previous, current, entry.uid);
      const previousState = previous ? JSON.stringify(previous) : null;
      const currentState = current ? JSON.stringify(current) : null;
      if (previousState === currentState) return;

      tx.set(entry.projectionRef, {
        version: 1, chatId, participantUid: entry.uid, unreadCount: nextCount,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      if (current) {
        tx.set(entry.checkpointRef, current);
      } else {
        tx.delete(entry.checkpointRef);
      }
    });
  }, { maxAttempts: DIRECT_UNREAD_MAX_TRANSACTION_ATTEMPTS });
}

export async function reconcileDirectUnreadMessage(
  chatId: string,
  messageId: string,
  expectedParticipants?: readonly string[],
  expectedMessageIds?: readonly string[]
): Promise<void> {
  return reconcileDirectUnreadMessageInternal(chatId, messageId, expectedParticipants, expectedMessageIds);
}

/** Test-only seam, never included in the deployed Functions export graph. */
export async function reconcileDirectUnreadMessageForEmulatorTest(
  chatId: string,
  messageId: string,
  expectedParticipants: readonly string[],
  expectedMessageIds: readonly string[],
  afterReads: () => Promise<void>
): Promise<void> {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required');
  return reconcileDirectUnreadMessageInternal(
    chatId, messageId, expectedParticipants, expectedMessageIds, afterReads
  );
}

export const syncDirectUnreadProjection = onDocumentWritten(
  { document: 'chats/{chatId}/messages/{messageId}', region: FUNCTIONS_REGION },
  async (event) => reconcileDirectUnreadMessage(event.params.chatId, event.params.messageId)
);
