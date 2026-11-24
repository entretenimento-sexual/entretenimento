// CHAT-R1.5: server-only discovery, including unreconciled historical chats.
// Returns identifiers only; every document read remains subject to Firestore Rules.
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../../../firebaseApp';
import { FUNCTIONS_REGION } from '../../../config/functions-region';
import { assertCallableAppCheck } from '../../../shared/security/callable-app-check';
import { consumeBackendRateLimitQuota } from '../../../shared/security/backend-rate-limit.service';
import { assertPlatformAccountAccessData } from '../../../account_lifecycle/interaction-access.policy';
import { assertDirectChatEmailVerified, isEligibleExistingDirectChat, ENSURE_DIRECT_CHAT_RATE_LIMIT_CONFIG } from '../domain/direct-chat.policy';

const MAX_CANDIDATES = 500;
const safeUid = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

export const listDirectChatCandidates = onCall<Record<string, never>>(
  { region: FUNCTIONS_REGION, invoker: 'public' },
  async (request): Promise<{ chatIds: string[] }> => {
    assertCallableAppCheck(request.app);
    const owner = request.auth?.uid;
    if (!safeUid(owner)) throw new HttpsError('unauthenticated', 'Sessão necessária.');
    assertDirectChatEmailVerified(request.auth?.token?.email_verified);
    await consumeBackendRateLimitQuota({
      action: 'list-direct-chat-candidates', subject: owner,
      config: ENSURE_DIRECT_CHAT_RATE_LIMIT_CONFIG,
      message: 'Muitas solicitações de conversas.',
    });
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
      const byPeer = new Map<string, string[]>();
      for (const chat of candidates.docs) {
        const data = chat.data();
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
      if (!peers.length) return { chatIds: [] };
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
      return { chatIds: chatIds.sort() };
    }, { readOnly: true });
  }
);
