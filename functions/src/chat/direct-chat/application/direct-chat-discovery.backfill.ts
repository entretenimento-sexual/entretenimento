// CHAT-R1.3: administrative, bounded reconciliation of historical direct chats.
// No callable export: this service is not a client discovery or authorization API.
import { FieldPath, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { db, FieldValue } from '../../../firebaseApp';
import {
  buildDirectChatPairIdentity,
  DIRECT_CHAT_POLICY_VERSION,
  isEligibleExistingDirectChat,
} from '../domain/direct-chat.policy';
import { stageDirectChatDiscoveryReferences } from './direct-chat-discovery.references';

const PAGE_SIZE = 100;
const MAX_USER_CHATS = 2000;

export type HistoricalDiscoveryBackfillStatus =
  | 'dry-run' | 'applied' | 'unchanged' | 'not-found' | 'manual-review';

export interface HistoricalDiscoveryBackfillResult {
  status: HistoricalDiscoveryBackfillStatus;
  scanned: number;
  candidates: number;
  reason?: string;
}

function safeUid(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value)
    && !value.startsWith('deleted:');
}

function safeChatId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value);
}

function accountRetained(data: FirebaseFirestore.DocumentData | undefined): boolean {
  return Boolean(data && data['deletedAt'] == null
    && data['deletionRequestedAt'] == null
    && String(data['accountStatus'] ?? 'active').toLowerCase() !== 'deleted');
}

/**
 * Exhaustively scans a single owner's chat candidates; never uses friendship
 * and never reads messages. Ambiguity/scan saturation fails closed.
 * A pair must have exactly one eligible persisted chat to be backfilled.
 */
async function readPairCandidates(
  participants: readonly [string, string]
): Promise<{ scanned: number; candidates: QueryDocumentSnapshot[]; truncated: boolean }> {
  const owner = participants[0];
  const candidates: QueryDocumentSnapshot[] = [];
  let scanned = 0;
  let cursor: QueryDocumentSnapshot | undefined;
  while (scanned <= MAX_USER_CHATS) {
    let query = db.collection('chats')
      .where('participants', 'array-contains', owner)
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) return { scanned, candidates, truncated: false };
    for (const snapshot of page.docs) {
      scanned += 1;
      if (isEligibleExistingDirectChat(snapshot.data(), participants)) {
        candidates.push(snapshot);
      }
    }
    if (scanned > MAX_USER_CHATS) break;
    cursor = page.docs[page.docs.length - 1];
    if (page.size < PAGE_SIZE) return { scanned, candidates, truncated: false };
  }
  return { scanned, candidates, truncated: true };
}

/**
 * Backfills exactly one unambiguous historical pair. Does not create chats,
 * touch messages, grant read permission, or authorize sending. Registers the
 * unique existing chat transactionally to fence concurrent ensureDirectChat.
 * dry-run is the default, and no production-wide sweep is exposed.
 */
export async function reconcileHistoricalDirectChatDiscovery(
  participantA: string,
  participantB: string,
  apply = false
): Promise<HistoricalDiscoveryBackfillResult> {
  if (!safeUid(participantA) || !safeUid(participantB) || participantA === participantB) {
    return { status: 'manual-review', scanned: 0, candidates: 0, reason: 'invalid-participants' };
  }
  const pair = buildDirectChatPairIdentity(participantA, participantB);
  const scan = await readPairCandidates(pair.participants);
  const basic = { scanned: scan.scanned, candidates: scan.candidates.length };
  if (scan.truncated) return { status: 'manual-review', ...basic, reason: 'scan-limit' };
  if (scan.candidates.length === 0) return { status: 'not-found', ...basic };
  if (scan.candidates.length !== 1) {
    return { status: 'manual-review', ...basic, reason: 'multiple-histories' };
  }

  const candidate = scan.candidates[0];
  if (!safeChatId(candidate.id)) {
    return { status: 'manual-review', ...basic, reason: 'invalid-chat-id' };
  }
  const chatRef = db.collection('chats').doc(candidate.id);
  const registryRef = db.collection('direct_chat_pairs').doc(pair.canonicalHash);
  const legacyRegistryRef = db.collection('direct_chat_pairs').doc(pair.legacyHash);
  const deterministicRef = db.collection('chats').doc(`direct_${pair.canonicalHash}`);
  const [first, second] = pair.participants.map(uid => db.collection('users').doc(uid));
  const discoveryRefs = pair.participants.map(uid =>
    db.doc(`direct_chat_discovery/${uid}/chats/${candidate.id}`));

  return db.runTransaction(async transaction => {
    // All transaction reads precede any writes.
    const [chat, registry, oldRegistry, deterministic, userA, userB, refA, refB] =
      await Promise.all([
        transaction.get(chatRef),
        transaction.get(registryRef),
        transaction.get(legacyRegistryRef),
        transaction.get(deterministicRef),
        transaction.get(first),
        transaction.get(second),
        transaction.get(discoveryRefs[0]),
        transaction.get(discoveryRefs[1]),
      ]);

    if (!chat.exists || !isEligibleExistingDirectChat(chat.data(), pair.participants)) {
      return { status: 'manual-review' as const, ...basic, reason: 'chat-changed' };
    }
    if (!accountRetained(userA.data()) || !accountRetained(userB.data())) {
      return { status: 'manual-review' as const, ...basic, reason: 'account-unavailable' };
    }
    const registeredId = registry.data()?.['chatId'];
    if (registry.exists && (!safeChatId(registeredId) || registeredId !== candidate.id)) {
      return { status: 'manual-review' as const, ...basic, reason: 'canonical-registry-conflict' };
    }
    if (deterministic.exists && deterministic.id !== candidate.id) {
      return { status: 'manual-review' as const, ...basic, reason: 'deterministic-conflict' };
    }
    if (oldRegistry.exists) {
      const oldChatId = oldRegistry.data()?.['chatId'];
      if (!safeChatId(oldChatId)) {
        return { status: 'manual-review' as const, ...basic, reason: 'legacy-registry-invalid' };
      }
      if (oldChatId !== candidate.id) {
        // v1 keys can collide. Reject only a second chat for THIS pair.
        const oldChat = await transaction.get(db.collection('chats').doc(oldChatId));
        if (oldChat.exists && isEligibleExistingDirectChat(oldChat.data(), pair.participants)) {
          return { status: 'manual-review' as const, ...basic, reason: 'legacy-registry-conflict' };
        }
      }
    }
    for (const ref of [refA, refB]) {
      const data = ref.data();
      if (ref.exists && (
        data?.['version'] !== 1 ||
        data?.['chatId'] !== candidate.id ||
        Object.keys(data ?? {}).sort().join('|') !== 'chatId|version'
      )) {
        return { status: 'manual-review' as const, ...basic, reason: 'reference-conflict' };
      }
    }
    const alreadyComplete = registry.exists && refA.exists && refB.exists;
    if (!apply) {
      return { status: 'dry-run' as const, ...basic };
    }
    if (alreadyComplete) return { status: 'unchanged' as const, ...basic };
    if (!registry.exists) {
      transaction.set(registryRef, {
        chatId: candidate.id,
        pairHash: pair.canonicalHash,
        pairKeyVersion: 2,
        participants: pair.participants,
        source: 'historical-discovery-backfill',
        policyVersion: DIRECT_CHAT_POLICY_VERSION,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    // Reference fields remain minimal and contain no authorization.
    stageDirectChatDiscoveryReferences(transaction, pair.participants, candidate.id);
    return { status: 'applied' as const, ...basic };
  });
}

export interface HistoricalDiscoveryBackfillPageResult {
  examined: number;
  applied: number;
  unchanged: number;
  needsReview: number;
  nextChatId: string | null;
}

/**
 * Bounded administrative sweep across existing chat documents. Each candidate
 * pair is rechecked in full before mutation, including across page boundaries.
 * No production job or callable is exported by this helper.
 */
export async function reconcileHistoricalDirectChatDiscoveryPage(
  afterChatId: string | null = null,
  apply = false,
  limit = 20
): Promise<HistoricalDiscoveryBackfillPageResult> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50
    || (afterChatId !== null && !safeChatId(afterChatId))) {
    throw new Error('Invalid bounded backfill page.');
  }
  let query = db.collection('chats')
    .orderBy(FieldPath.documentId())
    .limit(limit);
  if (afterChatId) query = query.startAfter(afterChatId);
  const page = await query.get();
  const seen = new Set<string>();
  let applied = 0;
  let unchanged = 0;
  let needsReview = 0;
  for (const snapshot of page.docs) {
    const chat = snapshot.data();
    if (!Array.isArray(chat.participants) ||
      chat.participants.length !== 2 ||
      chat.participants[0] === chat.participants[1] ||
      !chat.participants.every((uid: unknown) =>
        typeof uid === 'string' && safeUid(uid))) {
      continue;
    }
    const pair = buildDirectChatPairIdentity(
      chat.participants[0] as string, chat.participants[1] as string
    );
    if (!isEligibleExistingDirectChat(chat, pair.participants)) continue;
    if (seen.has(pair.canonicalHash)) continue;
    seen.add(pair.canonicalHash);
    const outcome = await reconcileHistoricalDirectChatDiscovery(
      pair.participants[0], pair.participants[1], apply
    );
    if (outcome.status === 'applied') applied += 1;
    else if (outcome.status === 'unchanged' || outcome.status === 'dry-run') unchanged += 1;
    else needsReview += 1;
  }
  return {
    examined: page.size,
    applied,
    unchanged,
    needsReview,
    nextChatId: page.size === limit ? page.docs[page.docs.length - 1].id : null,
  };
}
