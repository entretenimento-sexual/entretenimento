import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { FieldPath } from 'firebase-admin/firestore';
import { db } from '../../../firebaseApp';
import { FUNCTIONS_REGION } from '../../../config/functions-region';
import { assertPlatformAccountAccessData } from '../../../account_lifecycle/interaction-access.policy';
import { stageDirectChatDiscoveryInvalidation } from './direct-chat-discovery.references';

function eligible(data: FirebaseFirestore.DocumentData | undefined): boolean {
  try {
    assertPlatformAccountAccessData(data);
    return true;
  } catch {
    return false;
  }
}

export function discoveryEligibilityChanged(
  before: FirebaseFirestore.DocumentData | undefined,
  after: FirebaseFirestore.DocumentData | undefined
): boolean {
  return eligible(before) !== eligible(after) ||
    JSON.stringify(before?.moderationAutomationHold ?? null) !==
    JSON.stringify(after?.moderationAutomationHold ?? null);
}

export async function invalidateDirectChatPeers(uid: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) return;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  // Includes unindexed histories. Bounded pages, no message reads.
  while (true) {
    let query = db.collection('chats').where('participants', 'array-contains', uid)
      .orderBy(FieldPath.documentId()).limit(100);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    const peers = new Set<string>();
    for (const chat of page.docs) {
      const pair = chat.data().participants;
      if (!Array.isArray(pair) || pair.length !== 2 || !pair.includes(uid)) continue;
      for (const peer of pair) {
        if (typeof peer === 'string' && peer !== uid && /^[A-Za-z0-9_-]{1,128}$/.test(peer)) {
          peers.add(peer);
        }
      }
    }
    if (peers.size) {
      await db.runTransaction(async tx => {
        const owners = [...peers];
        const accounts = await tx.getAll(...owners.map(owner => db.doc('users/' + owner)));
        accounts.forEach((account, index) => {
          if (account.exists && account.data()?.accountStatus !== 'deleted') {
            stageDirectChatDiscoveryInvalidation(tx, owners[index]);
          }
        });
      });
    }
    if (page.size < 100) return;
    cursor = page.docs[page.docs.length - 1];
  }
}

export const syncDirectChatDiscoveryLifecycle = onDocumentWritten(
  { document: 'users/{uid}', region: FUNCTIONS_REGION, retry: true },
  async event => {
    if (discoveryEligibilityChanged(event.data?.before.data(), event.data?.after.data())) {
      await invalidateDirectChatPeers(event.params.uid);
    }
  }
);
