/**
 * Auditoria read-only de projeções para migração controlada.
 * Não cria documentos, não altera checkpoints e não ativa triggers.
 * O cursor é um ID de mensagem, usado somente dentro da conversa indicada.
 */
import { db } from '../../../firebaseApp';
import { isDirectMessageUnread, type DirectUnreadMessage } from '../domain/direct-unread-projection.policy';

export interface DirectUnreadAuditPage {
  chatId: string;
  participantUid: string;
  scanned: number;
  unreadInPage: number;
  nextCursor: string | null;
  complete: boolean;
  storedUnreadCount: number | null;
  comparison: 'INCOMPLETE' | 'MATCH' | 'MISMATCH' | 'NO_PROJECTION' | 'INCONCLUSIVE';
  readBudgetUsed: number;
  consistency: 'SINGLE_QUERY' | 'UNVERIFIED_MULTI_PAGE';
}

export async function auditDirectUnreadPage(
  chatId: string,
  participantUid: string,
  cursor: string | null = null,
  pageSize = 100,
  previousScanned = 0,
  previousUnread = 0
): Promise<DirectUnreadAuditPage> {
  const maxScanned = 1000;
  if (!chatId || !participantUid || !Number.isSafeInteger(pageSize) ||
      pageSize < 1 || pageSize > 100 || !Number.isSafeInteger(previousScanned) ||
      previousScanned < 0 || previousScanned + pageSize > maxScanned ||
      !Number.isSafeInteger(previousUnread) || previousUnread < 0 ||
      previousUnread > previousScanned || (previousScanned > 0 && !cursor) ||
      (cursor !== null && previousScanned === 0)) {
    throw new Error('Invalid unread audit parameters');
  }
  const chatRef = db.collection('chats').doc(chatId);
  const chat = await chatRef.get();
  const participants = chat.data()?.participants;
  if (!Array.isArray(participants) || participants.length !== 2 ||
      !participants.includes(participantUid)) throw new Error('Invalid chat participant');

  let query = chatRef.collection('messages').orderBy('__name__').limit(pageSize + 1);
  if (cursor) {
    const cursorDoc = await chatRef.collection('messages').doc(cursor).get();
    if (!cursorDoc.exists) throw new Error('Unread audit cursor no longer exists');
    query = query.startAfter(cursorDoc);
  }
  const page = await query.get();
  const docs = page.docs.slice(0, pageSize);
  const hasMore = page.docs.length > pageSize;
  const count = docs.reduce((sum, doc) => {
    const data = doc.data();
    const senderUid = String(data.senderId ?? data.senderUid ?? '');
    const status = data.status;
    if (!participants.includes(senderUid) || !['sent', 'delivered', 'read'].includes(status)) return sum;
    const message: DirectUnreadMessage = {
      messageId: doc.id, senderUid, status, deleted: data.deleted === true,
    };
    return sum + Number(isDirectMessageUnread(message, participantUid));
  }, previousUnread);

  const scanned = previousScanned + docs.length;
  const projection = await db.collection('direct_chat_unread_projections')
    .doc(participantUid).collection('chats').doc(chatId).get();
  const value = projection.data()?.unreadCount;
  const storedUnreadCount = Number.isSafeInteger(value) && value >= 0 ? value : null;
  const complete = !hasMore;
  // Consultas sucessivas não compartilham um snapshot consistente. Nunca
  // certificar MATCH/MISMATCH com totais acumulados de páginas independentes.
  const multiPage = previousScanned > 0;
  return {
    chatId, participantUid, scanned, unreadInPage: count,
    nextCursor: hasMore ? docs[docs.length - 1].id : null,
    complete, storedUnreadCount,
    consistency: multiPage ? 'UNVERIFIED_MULTI_PAGE' : 'SINGLE_QUERY',
    readBudgetUsed: 2 + page.docs.length + Number(Boolean(cursor)),
    comparison: !complete ? 'INCOMPLETE' : multiPage ? 'INCONCLUSIVE' :
      !projection.exists ? 'NO_PROJECTION' :
      storedUnreadCount === count ? 'MATCH' : 'MISMATCH',
  };
}
