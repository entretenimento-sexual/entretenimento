import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { db } from '../../../firebaseApp';
import { TERMS_ACCEPTANCE_VERSION, TERMS_DOCUMENT_VERSION, PRIVACY_NOTICE_VERSION } from '../../../compliance/platform-legal.constants';
import { compareShadowUnreadOnEmulator } from './direct-unread-shadow-compare.emulator';
import { rebuildShadowDirectUnreadGlobalOnEmulator } from './direct-unread-global.emulator';
import { reconcileShadowUnreadAccessOnEmulator } from './direct-unread-access.emulator';

const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
run('shadow unread comparison', () => {
  it('detects stale receipt, access and aggregate independently without writes', async () => {
    const id = 'compare-' + randomUUID(), a = id + '-a', b = id + '-b';
    const chat = db.collection('chats').doc(id);
    const owner = db.collection('users').doc(a), peer = db.collection('users').doc(b);
    const root = db.collection('direct_chat_unread_projections').doc(a);
    const projection = root.collection('chats').doc(id);
    const msg = chat.collection('messages').doc('m');
    const profile = (uid: string) => ({ uid, accountStatus: 'active', profileCompleted: true,
      acceptedTerms: { accepted: true, acknowledgedPrivacyNotice: true, version: TERMS_ACCEPTANCE_VERSION,
        termsDocumentVersion: TERMS_DOCUMENT_VERSION, privacyNoticeVersion: PRIVACY_NOTICE_VERSION } });
    try {
      await Promise.all([chat.set({ participants: [a,b] }), owner.set(profile(a)), peer.set(profile(b)),
        msg.set({ senderId: b, status: 'sent' }),
        projection.set({ version: 1, chatId: id, participantUid: a, unreadCount: 1 })]);
      await rebuildShadowDirectUnreadGlobalOnEmulator(a);
      await reconcileShadowUnreadAccessOnEmulator(id, a);
      const initial = await compareShadowUnreadOnEmulator(id, a);
      assert.equal(initial.individual, 'MATCH');
      assert.equal(initial.access, 'MATCH');
      assert.equal(initial.global, 'MATCH');
      assert.equal(initial.globalSourceCoverage, 'INCONCLUSIVE');
      await msg.update({ status: 'read' });
      await owner.collection('blocks').doc(b).set({ isBlocked: true });
      await root.update({ projectedUnreadCount: 7 });
      const before = await root.get();
      const result = await compareShadowUnreadOnEmulator(id, a);
      assert.equal(result.individual, 'MISMATCH');
      assert.equal(result.access, 'MISMATCH');
      assert.equal(result.global, 'MISMATCH');
      assert.equal(result.mutationCount, 0);
      assert.equal((await root.get()).updateTime?.toMillis(), before.updateTime?.toMillis());
      assert.equal((await projection.get()).data()?.unreadCount, 1);
    } finally {
      await Promise.all([db.recursiveDelete(chat), db.recursiveDelete(owner), db.recursiveDelete(peer), db.recursiveDelete(root)]);
    }
  });
});
