import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, describe, it } from 'node:test';
import { db } from '../../../firebaseApp';
import { TERMS_ACCEPTANCE_VERSION, TERMS_DOCUMENT_VERSION, PRIVACY_NOTICE_VERSION } from '../../../compliance/platform-legal.constants';
import { reconcileShadowUnreadAccessOnEmulator } from './direct-unread-access.emulator';

const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
run('shadow unread exposure', () => {
  const prefix = 'shadow-access-' + randomUUID();
  const a = prefix + '-a', b = prefix + '-b';
  const chat = db.collection('chats').doc(prefix);
  const owner = db.collection('users').doc(a), peer = db.collection('users').doc(b);
  const root = db.collection('direct_chat_unread_projections').doc(a);
  const projection = root.collection('chats').doc(prefix);
  const profile = (uid: string) => ({ uid, accountStatus: 'active', profileCompleted: true,
    acceptedTerms: { accepted: true, acknowledgedPrivacyNotice: true, version: TERMS_ACCEPTANCE_VERSION,
      termsDocumentVersion: TERMS_DOCUMENT_VERSION, privacyNoticeVersion: PRIVACY_NOTICE_VERSION } });
  after(async () => { await Promise.all([db.recursiveDelete(chat), db.recursiveDelete(owner),
    db.recursiveDelete(peer), db.recursiveDelete(root)]); });
  it('suppresses both block directions and lifecycle restrictions without mutating receipts', async () => {
    await Promise.all([chat.set({ participants: [a,b] }), owner.set(profile(a)), peer.set(profile(b)),
      projection.set({ version: 1, participantUid: a, chatId: prefix, unreadCount: 4 })]);
    const check = async (expected: number) => {
      const result = await reconcileShadowUnreadAccessOnEmulator(prefix, a);
      assert.equal(result.projectedVisibleUnreadCount, expected);
      assert.equal(result.coverage, 'UNVERIFIED');
      assert.equal((await projection.get()).data()?.unreadCount, 4);
    };
    await check(4); // No friendship documents required for history.
    for (const block of [owner.collection('blocks').doc(b), peer.collection('blocks').doc(a)]) {
      await block.set({ isBlocked: true }); await check(0);
      await block.delete(); await check(4);
    }
    await peer.update({ accountStatus: 'pending_deletion' }); await check(0);
    await peer.update({ accountStatus: 'active' }); await check(4);
    await owner.update({ suspended: true }); await check(0);
    await owner.update({ suspended: false }); await check(4);
    await chat.delete(); await check(0);
  });
});
