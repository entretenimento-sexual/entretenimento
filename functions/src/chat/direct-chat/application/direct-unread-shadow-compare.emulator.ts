/** Read-only emulator comparison; no automatic correction or cutover. */
import { db } from '../../../firebaseApp';
import { normalizeDirectUnreadMessage, isDirectMessageUnread } from '../domain/direct-unread-projection.policy';
import { buildShadowUnreadAggregate, MAX_SHADOW_UNREAD_CHATS } from '../domain/direct-unread-global.policy';
import { isEligibleExistingDirectChat } from '../domain/direct-chat.policy';
import { evaluateShadowHistoryAccessInTransaction } from './direct-unread-access.emulator';
import { DIRECT_UNREAD_MAX_TRANSACTION_ATTEMPTS } from '../domain/direct-unread-backfill-budget.policy';

type Comparison = 'MATCH' | 'MISMATCH' | 'MISSING' | 'INVALID' | 'INCONCLUSIVE';
const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const validCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function compare(expected: number | null, stored: unknown, exists: boolean): Comparison {
  if (expected === null) return 'INCONCLUSIVE';
  if (!exists) return 'MISSING';
  if (!validCount(stored)) return 'INVALID';
  return expected === stored ? 'MATCH' : 'MISMATCH';
}

export async function compareShadowUnreadOnEmulator(chatId: string, ownerUid: string) {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const projects = [process.env.GCLOUD_PROJECT, process.env.GOOGLE_CLOUD_PROJECT, process.env.GCP_PROJECT].filter(Boolean);
  if (!host || !/^(127\.0\.0\.1|localhost):[0-9]{1,5}$/.test(host) ||
      !projects.length || projects.some(id => id !== 'demo-entretenimento') ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('Isolated demo emulator required');
  if (!validId(chatId) || !validId(ownerUid)) throw new Error('Invalid comparison scope');
  const chatRef = db.collection('chats').doc(chatId);
  const root = db.collection('direct_chat_unread_projections').doc(ownerUid);
  const projectionRef = root.collection('chats').doc(chatId);
  return db.runTransaction(async tx => {
    const chat = await tx.get(chatRef);
    const pair = chat.data()?.participants;
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(validId) ||
        pair[0] === pair[1] || !pair.includes(ownerUid) ||
        !isEligibleExistingDirectChat(chat.data(), pair)) throw new Error('Invalid direct chat scope');
    const [messages, projection, access, global, rows] = await Promise.all([
      tx.get(chatRef.collection('messages').orderBy('__name__').limit(101)),
      tx.get(projectionRef), tx.get(projectionRef.collection('shadow_access').doc('current')),
      tx.get(root), tx.get(root.collection('chats').orderBy('__name__').limit(MAX_SHADOW_UNREAD_CHATS + 1)),
    ]);
    const available = await evaluateShadowHistoryAccessInTransaction(tx, ownerUid, pair.find(uid => uid !== ownerUid)!);
    const actual = messages.size > 100 ? null : messages.docs.reduce((sum, doc) => {
      const message = normalizeDirectUnreadMessage(doc.id, doc.data(), pair);
      return sum + Number(!!message && isDirectMessageUnread(message, ownerUid));
    }, 0);
    const individual = projection.data();
    const projectionValid = individual?.version === 1 && individual.chatId === chatId &&
      individual.participantUid === ownerUid && validCount(individual.unreadCount);
    const individualComparison = projection.exists && !projectionValid ? 'INVALID' :
      compare(actual, individual?.unreadCount, projection.exists);
    const expectedVisible = !available ? 0 : actual;
    const accessData = access.data();
    const accessComparison = access.exists && (accessData?.version !== 1 ||
      accessData.coverage !== 'UNVERIFIED' || typeof accessData.available !== 'boolean') ? 'INVALID' :
      access.exists && accessData?.available !== available ? 'MISMATCH' :
      compare(expectedVisible, accessData?.projectedVisibleUnreadCount, access.exists);
    let globalComparison: Comparison = 'INCONCLUSIVE';
    let projectedSum: number | null = null;
    if (rows.size <= MAX_SHADOW_UNREAD_CHATS) {
      try {
        const expected = buildShadowUnreadAggregate(ownerUid, rows.docs.map(doc => ({ id: doc.id, data: doc.data() })));
        projectedSum = expected.projectedUnreadCount;
        const stored = global.data();
        globalComparison = !global.exists ? 'MISSING' :
          stored?.version !== 1 || stored.participantUid !== ownerUid ||
          stored.coverage !== 'UNVERIFIED' || !validCount(stored.projectedChatCount) ||
          !validCount(stored.projectedUnreadCount) ? 'INVALID' :
          stored.projectedChatCount !== expected.projectedChatCount ? 'MISMATCH' :
          compare(projectedSum, stored.projectedUnreadCount, true);
      } catch {
        globalComparison = 'INVALID';
      }
    }
    return { mode: 'SHADOW_READ_ONLY' as const, mutationCount: 0, coverage: 'UNVERIFIED' as const,
      chatId, ownerUid, actualUnreadCount: actual,
      individual: individualComparison, access: accessComparison, global: globalComparison,
      projectedSum, expectedVisibleUnreadCount: expectedVisible,
      // Global comparison covers existing projections, never complete source coverage.
      globalSourceCoverage: 'INCONCLUSIVE' as const };
  }, { maxAttempts: DIRECT_UNREAD_MAX_TRANSACTION_ATTEMPTS });
}
