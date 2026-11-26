// CHAT-R1.5: server-only discovery, including unreconciled historical chats.
// Returns identifiers only; every document read remains subject to Firestore Rules.
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { FieldPath, Timestamp, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import { createHash, randomBytes } from 'node:crypto';
import { db } from '../../../firebaseApp';
import { FUNCTIONS_REGION } from '../../../config/functions-region';
import { assertCallableAppCheck } from '../../../shared/security/callable-app-check';
import { consumeBackendRateLimitQuota } from '../../../shared/security/backend-rate-limit.service';
import { assertPlatformAccountAccessData } from '../../../account_lifecycle/interaction-access.policy';
import {
  assertDirectChatEmailVerified,
  isEligibleExistingDirectChat,
  ENSURE_DIRECT_CHAT_RATE_LIMIT_CONFIG,
} from '../domain/direct-chat.policy';

// Legacy transport remains unchanged until selected-chat access and the UI
// have migrated. Paged transport scans a bounded canonical document window.
const MAX_CANDIDATES = 500;
const MAX_PAGE_SIZE = 100;
const CURSOR_TTL_MS = 15 * 60_000;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]{43}$/;
type PageRequest = { pageSize: number; cursor: string | null; order: 'id' | 'activity' };
type CandidateResponse = { chatIds: string[] };
type PageResponse = CandidateResponse & { nextCursor: string | null; revision: number };
type DiscoveryRequest = { pageSize?: number; cursor?: string | null; chatId?: string; order?: 'activity' };

function parsePageRequest(raw: unknown): PageRequest | null {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpsError('invalid-argument', 'Página de conversas inválida.');
  }
  const data = raw as Record<string, unknown>;
  if (Object.keys(data).length === 0) return null;
  if (Object.keys(data).some(key => key !== 'pageSize' && key !== 'cursor' && key !== 'order') ||
      (data.order !== undefined && data.order !== 'activity') ||
      typeof data.pageSize !== 'number' || !Number.isInteger(data.pageSize) ||
      data.pageSize < 1 || data.pageSize > MAX_PAGE_SIZE ||
      (data.cursor != null && (typeof data.cursor !== 'string' || !CURSOR_PATTERN.test(data.cursor)))) {
    throw new HttpsError('invalid-argument', 'Página de conversas inválida.');
  }
  return {
    pageSize: data.pageSize,
    cursor: (data.cursor as string | null | undefined) ?? null,
    order: data.order === 'activity' ? 'activity' : 'id',
  };
}

function cursorReference(owner: string, token: string) {
  const hash = createHash('sha256').update(token).digest('hex');
  return db.doc(`direct_chat_discovery/${owner}/direct_chat_page_cursors/${hash}`);
}

function invalidCursor(): HttpsError {
  // Same response for unknown, expired, foreign and stale tokens.
  return new HttpsError('failed-precondition', 'Página expirada ou alterada. Reinicie a consulta.');
}

function readRevision(snapshot: FirebaseFirestore.DocumentSnapshot): number {
  if (!snapshot.exists) return 0;
  const data = snapshot.data();
  if (data?.version !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 0) {
    throw invalidCursor();
  }
  return data.revision as number;
}
const safeUid = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

export const listDirectChatCandidates = onCall<DiscoveryRequest>(
  { region: FUNCTIONS_REGION, invoker: 'public' },
  async (request): Promise<CandidateResponse | PageResponse> => {
    assertCallableAppCheck(request.app);
    const owner = request.auth?.uid;
    if (!safeUid(owner)) throw new HttpsError('unauthenticated', 'Sessão necessária.');
    assertDirectChatEmailVerified(request.auth?.token?.email_verified);
    await consumeBackendRateLimitQuota({
      action: 'list-direct-chat-candidates', subject: owner,
      config: ENSURE_DIRECT_CHAT_RATE_LIMIT_CONFIG,
      message: 'Muitas solicitações de conversas.',
    });
    if (request.data && Object.prototype.hasOwnProperty.call(request.data, 'chatId')) {
      const chatId = request.data.chatId;
      if (Object.keys(request.data).length !== 1 || typeof chatId !== 'string' ||
          !chatId || chatId.includes('/') || Buffer.byteLength(chatId) > 1500 ||
          chatId === '.' || chatId === '..' || /^__.*__$/.test(chatId)) {
        throw new HttpsError('invalid-argument', 'Conversa inválida.');
      }
      return db.runTransaction(async tx => {
        const actor = await tx.get(db.doc('users/' + owner));
        assertPlatformAccountAccessData(actor.data());
        const chat = await tx.get(db.collection('chats').doc(chatId));
        return { chatIds: await authorizeCandidates(tx, owner, [chat]) };
      }, { readOnly: true });
    }
    const page = parsePageRequest(request.data);
    if (page) return page.order === 'activity' ? listActivityPage(owner, page) : listPage(owner, page);
    return db.runTransaction(async tx => {
      const actor = await tx.get(db.doc('users/' + owner));
      assertPlatformAccountAccessData(actor.data());
      // Transitional authoritative scan: includes old histories without R1.3 backfill.
      // No friendship requirement: reading a history is not permission to send.
      const candidates = await tx.get(db.collection('chats')
        .where('participants', 'array-contains', owner).limit(MAX_CANDIDATES + 1));
      if (candidates.size > MAX_CANDIDATES) {
        throw new HttpsError('resource-exhausted', 'Limite de descoberta excedido.');
      }
      return { chatIds: (await authorizeCandidates(tx, owner, candidates.docs)).sort() };
    }, { readOnly: true });
  }
);

// Both transports share the same canonical bilateral and lifecycle checks.
async function authorizeCandidates(
  tx: Transaction, owner: string, candidates: readonly DocumentSnapshot[]
): Promise<string[]> {
  const byPeer = new Map<string, string[]>();
  for (const chat of candidates) {
    const data = chat.data();
    if (!data) continue;
    const pair = data.participants;
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.includes(owner)
      || !pair.every(safeUid) || !isEligibleExistingDirectChat(data, pair)) continue;
    const peer = pair.find(value => value !== owner);
    if (!safeUid(peer)) continue;
    const ids = byPeer.get(peer) ?? [];
    ids.push(chat.id);
    byPeer.set(peer, ids);
  }
  const peers = [...byPeer.keys()];
  if (!peers.length) return [];
  const refs = peers.flatMap(peer => [
    db.doc('users/' + peer),
    db.doc('users/' + owner + '/blocks/' + peer),
    db.doc('users/' + peer + '/blocks/' + owner),
  ]);
  const snapshots = await tx.getAll(...refs);
  const chatIds: string[] = [];
  peers.forEach((peer, index) => {
    const [account, outgoing, incoming] = snapshots.slice(index * 3, index * 3 + 3);
    if (outgoing.data()?.isBlocked === true || incoming.data()?.isBlocked === true) return;
    try {
      assertPlatformAccountAccessData(account.data());
    } catch (error) {
      if (error instanceof HttpsError) return;
      throw error;
    }
    chatIds.push(...(byPeer.get(peer) ?? []));
  });

  return chatIds;
}

async function listPage(owner: string, page: PageRequest): Promise<PageResponse> {
  const now = Date.now();
  const result = await db.runTransaction(async tx => {
    const actor = await tx.get(db.doc('users/' + owner));
    assertPlatformAccountAccessData(actor.data());
    const revision = readRevision(await tx.get(db.doc('direct_chat_discovery/' + owner)));
    let after: string | null = null;
    if (page.cursor) {
      const snapshot = await tx.get(cursorReference(owner, page.cursor));
      const state = snapshot.data();
      if (!state || state.version !== 1 || state.revision !== revision ||
          state.pageSize !== page.pageSize || !(state.expiresAt instanceof Timestamp) ||
          state.expiresAt.toMillis() <= now || typeof state.after !== 'string' ||
          !state.after || state.after.includes('/')) {
        throw invalidCursor();
      }
      after = state.after;
    }
    // Stable document ID order deliberately includes unindexed legacy chats
    // and records lacking timestamp. UI recency is a separate concern.
    let query = db.collection('chats').where('participants', 'array-contains', owner)
      .orderBy(FieldPath.documentId()).limit(page.pageSize + 1);
    if (after) query = query.startAfter(after);
    const candidates = await tx.get(query);
    const consumed = candidates.docs.slice(0, page.pageSize);
    const allowed = new Set(await authorizeCandidates(tx, owner, consumed));
    const chatIds = consumed.filter(chat => allowed.has(chat.id)).map(chat => chat.id);
    const nextAfter = candidates.size > page.pageSize ? consumed[consumed.length - 1]?.id ?? null : null;
    return { chatIds, revision, nextAfter };
  }, { readOnly: true });
  // No denied document identifier is included in the client token, even
  // when the entire scanned window is filtered out. Tokens survive retries
  // and instances; expiry is enforced synchronously, not by TTL deletion.
  let nextCursor: string | null = null;
  if (result.nextAfter) {
    nextCursor = randomBytes(32).toString('base64url');
    await cursorReference(owner, nextCursor).create({
      version: 1,
      revision: result.revision,
      pageSize: page.pageSize,
      after: result.nextAfter,
      expiresAt: Timestamp.fromMillis(now + CURSOR_TTL_MS),
    });
  }
  return { chatIds: result.chatIds, nextCursor, revision: result.revision };
}

type ActivityPosition = {
  phase: 'recent' | 'legacy';
  after: string | null;
  afterTimestamp: Timestamp | null;
};

const INITIAL_ACTIVITY_POSITION: ActivityPosition = { phase: 'recent', after: null, afterTimestamp: null };
const MIN_ACTIVITY_TIMESTAMP = new Timestamp(-62135596800, 0);
const MAX_ACTIVITY_TIMESTAMP = new Timestamp(253402300799, 999999999);

async function readActivityPosition(
  tx: Transaction, owner: string, page: PageRequest, revision: number, now: number
): Promise<ActivityPosition> {
  if (!page.cursor) return INITIAL_ACTIVITY_POSITION;
  const snapshot = await tx.get(cursorReference(owner, page.cursor));
  const data = snapshot.data();
  if (!data || data.version !== 2 || data.order !== 'activity' ||
      data.revision !== revision || data.pageSize !== page.pageSize ||
      !(data.expiresAt instanceof Timestamp) || data.expiresAt.toMillis() <= now ||
      (data.after !== null && (typeof data.after !== 'string' || !data.after || data.after.includes('/')))) {
    throw invalidCursor();
  }
  if (data.phase === 'recent' && typeof data.after === 'string' && data.afterTimestamp instanceof Timestamp) {
    return { phase: 'recent', after: data.after, afterTimestamp: data.afterTimestamp };
  }
  if (data.phase === 'legacy' && data.afterTimestamp === null) {
    return { phase: 'legacy', after: data.after, afterTimestamp: null };
  }
  throw invalidCursor();
}

async function listActivityPage(owner: string, page: PageRequest): Promise<PageResponse> {
  const now = Date.now();
  const result = await db.runTransaction(async tx => {
    const actor = await tx.get(db.doc('users/' + owner));
    assertPlatformAccountAccessData(actor.data());
    const revision = readRevision(await tx.get(db.doc('direct_chat_discovery/' + owner)));
    const position = await readActivityPosition(tx, owner, page, revision, now);
    const chats = db.collection('chats').where('participants', 'array-contains', owner);
    let query = position.phase === 'recent'
      ? chats.where('timestamp', '>=', MIN_ACTIVITY_TIMESTAMP)
        .where('timestamp', '<=', MAX_ACTIVITY_TIMESTAMP)
        .orderBy('timestamp', 'desc').orderBy(FieldPath.documentId(), 'desc')
      : chats.orderBy(FieldPath.documentId());
    if (position.after !== null) {
      query = position.phase === 'recent'
        ? query.startAfter(position.afterTimestamp, position.after)
        : query.startAfter(position.after);
    }
    const candidates = await tx.get(query.limit(page.pageSize + 1));
    const consumed = candidates.docs.slice(0, page.pageSize);
    // Missing and malformed timestamps require a bounded complementary scan.
    const eligible = consumed.filter(chat =>
      (chat.get('timestamp') instanceof Timestamp) === (position.phase === 'recent'));
    const allowed = new Set(await authorizeCandidates(tx, owner, eligible));
    const chatIds = eligible.filter(chat => allowed.has(chat.id)).map(chat => chat.id);
    let next: ActivityPosition | null = null;
    if (candidates.size > page.pageSize) {
      const last = consumed[consumed.length - 1];
      if (position.phase === 'recent') {
        const timestamp = last.get('timestamp');
        if (!(timestamp instanceof Timestamp)) throw invalidCursor();
        next = { phase: 'recent', after: last.id, afterTimestamp: timestamp };
      } else {
        next = { phase: 'legacy', after: last.id, afterTimestamp: null };
      }
    } else if (position.phase === 'recent') {
      next = { phase: 'legacy', after: null, afterTimestamp: null };
    }
    return { chatIds, revision, next };
  }, { readOnly: true });

  let nextCursor: string | null = null;
  if (result.next) {
    nextCursor = randomBytes(32).toString('base64url');
    await cursorReference(owner, nextCursor).create({
      version: 2,
      order: 'activity',
      revision: result.revision,
      pageSize: page.pageSize,
      ...result.next,
      expiresAt: Timestamp.fromMillis(now + CURSOR_TTL_MS),
    });
  }
  return { chatIds: result.chatIds, revision: result.revision, nextCursor };
}
