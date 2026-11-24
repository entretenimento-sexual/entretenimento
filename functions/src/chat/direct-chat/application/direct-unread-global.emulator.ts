/** Emulator-only materialization; deliberately not exported from Functions index. */
import { db, FieldValue } from '../../../firebaseApp';
import { buildShadowUnreadAggregate, MAX_SHADOW_UNREAD_CHATS } from '../domain/direct-unread-global.policy';
import { DIRECT_UNREAD_MAX_TRANSACTION_ATTEMPTS } from '../domain/direct-unread-backfill-budget.policy';

export async function rebuildShadowDirectUnreadGlobalOnEmulator(participantUid: string) {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const projects = [
    process.env.GCLOUD_PROJECT, process.env.GOOGLE_CLOUD_PROJECT, process.env.GCP_PROJECT,
  ].filter(Boolean);
  if (!host || !/^(127\.0\.0\.1|localhost):[0-9]{1,5}$/.test(host) ||
      projects.length === 0 || projects.some(id => id !== 'demo-entretenimento') ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('Shadow unread aggregate requires isolated local demo emulator');
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(participantUid)) throw new Error('Invalid participant scope');
  const root = db.collection('direct_chat_unread_projections').doc(participantUid);
  return db.runTransaction(async tx => {
    const snapshot = await tx.get(root.collection('chats').orderBy('__name__').limit(MAX_SHADOW_UNREAD_CHATS + 1));
    const previous = await tx.get(root);
    const next = buildShadowUnreadAggregate(
      participantUid, snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() }))
    );
    const old = previous.data();
    const changed = !old || Object.entries(next).some(([key, value]) => old[key] !== value);
    if (changed) tx.set(root, { ...next, updatedAt: FieldValue.serverTimestamp() });
    return { ...next, changed };
  }, { maxAttempts: DIRECT_UNREAD_MAX_TRANSACTION_ATTEMPTS });
}
