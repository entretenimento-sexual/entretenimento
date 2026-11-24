/** Experimental access-aware shadow read. No production export or client grant. */
import { HttpsError } from 'firebase-functions/v2/https';
import { db, FieldValue } from '../../../firebaseApp';
import { assertPlatformAccountAccessData } from '../../../account_lifecycle/interaction-access.policy';
import { assertMessagingAccountOperational } from '../../shared/messaging-account.policy';
import { isBilateralBlockActive } from '../../../friendship/application/bilateral-block-access.policy';
import { isEligibleExistingDirectChat } from '../domain/direct-chat.policy';
import { DIRECT_UNREAD_MAX_TRANSACTION_ATTEMPTS } from '../domain/direct-unread-backfill-budget.policy';
import { buildShadowUnreadAggregate } from '../domain/direct-unread-global.policy';

export async function reconcileShadowUnreadAccessOnEmulator(chatId: string, ownerUid: string) {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const projects = [process.env.GCLOUD_PROJECT, process.env.GOOGLE_CLOUD_PROJECT, process.env.GCP_PROJECT].filter(Boolean);
  if (!host || !/^(127\.0\.0\.1|localhost):[0-9]{1,5}$/.test(host) ||
      !projects.length || projects.some(id => id !== 'demo-entretenimento') ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('Shadow access requires isolated local demo emulator');
  }
  const valid = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
  if (!valid(chatId) || !valid(ownerUid)) throw new Error('Invalid shadow access scope');
  const chatRef = db.collection('chats').doc(chatId);
  const projectionRef = db.collection('direct_chat_unread_projections').doc(ownerUid).collection('chats').doc(chatId);
  const accessRef = projectionRef.collection('shadow_access').doc('current');
  return db.runTransaction(async tx => {
    const [chat, projection, previous] = await Promise.all([tx.get(chatRef), tx.get(projectionRef), tx.get(accessRef)]);
    const participants: unknown = chat.data()?.participants;
    let available = false;
    let projectedVisibleUnreadCount = 0;
    if (Array.isArray(participants) && participants.length === 2 &&
        participants.every(valid) && participants.includes(ownerUid) &&
        participants[0] !== participants[1] &&
        isEligibleExistingDirectChat(chat.data(), participants)) {
      const peerUid = participants.find(uid => uid !== ownerUid)!;
      const owner = db.collection('users').doc(ownerUid);
      const peer = db.collection('users').doc(peerUid);
      const [a, b, ab, ba] = await Promise.all([
        tx.get(owner), tx.get(peer), tx.get(owner.collection('blocks').doc(peerUid)),
        tx.get(peer.collection('blocks').doc(ownerUid)),
      ]);
      try {
        assertMessagingAccountOperational(a.data(), { operation: 'ensure-direct-chat', perspective: 'actor' });
        assertMessagingAccountOperational(b.data(), { operation: 'ensure-direct-chat', perspective: 'target' });
        assertPlatformAccountAccessData(a.data());
        assertPlatformAccountAccessData(b.data());
        available = !isBilateralBlockActive({ actorBlock: ab.data(), targetBlock: ba.data() });
      } catch (error) {
        if (!(error instanceof HttpsError)) throw error;
        available = false;
      }
      // No friendship check: history exposure is separate from send permission.
      if (available && projection.exists) {
        projectedVisibleUnreadCount = buildShadowUnreadAggregate(ownerUid, [
          { id: chatId, data: projection.data()! },
        ]).projectedUnreadCount;
      }
    }
    const next = { version: 1, available, projectedVisibleUnreadCount,
      coverage: 'UNVERIFIED' as const };
    const old = previous.data();
    if (!old || Object.entries(next).some(([key, value]) => old[key] !== value)) {
      tx.set(accessRef, { ...next, updatedAt: FieldValue.serverTimestamp() });
    }
    return next;
  }, { maxAttempts: DIRECT_UNREAD_MAX_TRANSACTION_ATTEMPTS });
}
