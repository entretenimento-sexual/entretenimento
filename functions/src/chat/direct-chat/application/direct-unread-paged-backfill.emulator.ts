/** Experimental paged scan. Never writes live projections or certifies coverage.
 * Each page and cursor commit atomically. Concurrent source mutations before
 * the cursor are not detectable here; final coverage remains UNVERIFIED.
 */
import { db, FieldValue } from '../../../firebaseApp';
import { normalizeDirectUnreadMessage, isDirectMessageUnread } from '../domain/direct-unread-projection.policy';
import { isEligibleExistingDirectChat } from '../domain/direct-chat.policy';
import { DIRECT_UNREAD_MAX_TRANSACTION_ATTEMPTS } from '../domain/direct-unread-backfill-budget.policy';

export const SHADOW_BACKFILL_PAGE_SIZE = 100;
export const SHADOW_BACKFILL_MAX_MESSAGES = 10000;
const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

export async function advanceShadowUnreadBackfillOnEmulator(chatId: string, runId: string) {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const projects = [
    process.env.GCLOUD_PROJECT, process.env.GOOGLE_CLOUD_PROJECT, process.env.GCP_PROJECT,
  ].filter(Boolean);
  if (!host || !/^(127\.0\.0\.1|localhost):[0-9]{1,5}$/.test(host) ||
      !projects.length || projects.some(id => id !== 'demo-entretenimento') ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('Isolated demo emulator required');
  if (!validId(chatId) || !validId(runId)) throw new Error('Invalid scan scope');
  const chatRef = db.collection('chats').doc(chatId);
  const runRef = db.collection('direct_chat_unread_backfill_shadow_runs').doc(runId);
  return db.runTransaction(async tx => {
    const [chat, saved] = await Promise.all([tx.get(chatRef), tx.get(runRef)]);
    const pair = chat.data()?.participants;
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(validId) ||
        pair[0] === pair[1] || !isEligibleExistingDirectChat(chat.data(), pair)) {
      throw new Error('Invalid direct chat scope');
    }
    const participants = [...pair].sort() as [string, string];
    const old = saved.data();
    const scanned: number = old?.scanned ?? 0;
    const cursor: string | null = old?.cursor ?? null;
    const counts: number[] = old?.counts ?? [0, 0];
    if (old && (old.version !== 1 || old.chatId !== chatId ||
        JSON.stringify(old.participants) !== JSON.stringify(participants) ||
        old.coverage !== 'UNVERIFIED' ||
        !['RUNNING', 'SCAN_COMPLETE', 'LIMIT_REACHED'].includes(old.status) ||
        !Number.isSafeInteger(scanned) || scanned < 0 || scanned > SHADOW_BACKFILL_MAX_MESSAGES ||
        (scanned === 0 ? cursor !== null : typeof cursor !== 'string' || !cursor || cursor.includes('/')) ||
        !Array.isArray(counts) || counts.length !== 2 ||
        counts.some(n => !Number.isSafeInteger(n) || n < 0 || n > scanned) ||
        counts[0] + counts[1] > scanned ||
        (old.status === 'RUNNING' && scanned >= SHADOW_BACKFILL_MAX_MESSAGES))) {
      throw new Error('Invalid or incompatible shadow scan checkpoint');
    }
    if (old && old.status !== 'RUNNING') {
      return { chatId, runId, participants, scanned, cursor, counts, status: old.status,
        coverage: 'UNVERIFIED' as const, advanced: false };
    }
    const remaining = SHADOW_BACKFILL_MAX_MESSAGES - scanned;
    const size = Math.min(SHADOW_BACKFILL_PAGE_SIZE, remaining);
    let query = chatRef.collection('messages').orderBy('__name__').limit(size + 1);
    if (cursor !== null) query = query.startAfter(cursor);
    const page = await tx.get(query);
    const docs = page.docs.slice(0, size);
    const nextCounts = [...counts];
    for (const doc of docs) {
      const message = normalizeDirectUnreadMessage(doc.id, doc.data(), participants);
      if (message) participants.forEach((uid, index) => {
        nextCounts[index] += Number(isDirectMessageUnread(message, uid));
      });
    }
    const nextScanned = scanned + docs.length;
    const hasMore = page.size > size;
    const status = !hasMore ? 'SCAN_COMPLETE' :
      nextScanned >= SHADOW_BACKFILL_MAX_MESSAGES ? 'LIMIT_REACHED' : 'RUNNING';
    const next = { version: 1, chatId, participants, scanned: nextScanned,
      cursor: docs[docs.length - 1]?.id ?? cursor, counts: nextCounts, status,
      coverage: 'UNVERIFIED' as const };
    tx.set(runRef, { ...next, updatedAt: FieldValue.serverTimestamp() });
    return { ...next, runId, advanced: true };
  }, { maxAttempts: DIRECT_UNREAD_MAX_TRANSACTION_ATTEMPTS });
}
