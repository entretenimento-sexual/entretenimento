import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { db } from '../../../firebaseApp';
import { TERMS_ACCEPTANCE_VERSION } from '../../../compliance/platform-legal.constants';

const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
run('CHAT-R1.5 authorized discovery', () => {
  it('retains unindexed histories, excludes both block directions and unrelated chats', async () => {
    const prefix = 'r15-' + randomUUID();
    const owner = prefix + '-owner', peer = prefix + '-peer', outsider = prefix + '-other';
    const history = prefix + '-history', foreign = prefix + '-foreign';
    const user = (uid: string) => ({
      uid, profileCompleted: true, accountStatus: 'active',
      acceptedTerms: { accepted: true, version: TERMS_ACCEPTANCE_VERSION,
        termsDocumentVersion: '2026-09-29.1', privacyNoticeVersion: '2026-09-29.1',
        acknowledgedPrivacyNotice: true },
    });
    const environment = require('firebase-functions-test')({
      projectId: process.env.GCLOUD_PROJECT || 'demo-entretenimento',
    });
    const invoke = environment.wrap(require('./list-direct-chat-candidates.handler').listDirectChatCandidates);
    const request = (verified = true) => invoke({ data: {}, app: { appId: 'test-chat-app' },
      auth: { uid: owner, token: { email_verified: verified } } }, {});
    try {
      await Promise.all([owner, peer, outsider].map(uid => db.doc('users/' + uid).set(user(uid))));
      await db.doc('chats/' + history).set({ participants: [owner, peer] });
      await db.doc('chats/' + foreign).set({ participants: [peer, outsider] });
      await assert.rejects(request(false), { code: 'failed-precondition' });
      assert.deepEqual(await request(), { chatIds: [history] });
      for (const [a, b] of [[owner, peer], [peer, owner]]) {
        const block = db.doc('users/' + a + '/blocks/' + b);
        await block.set({ isBlocked: true });
        assert.deepEqual(await request(), { chatIds: [] });
        await block.delete();
      }
      assert.deepEqual(await request(), { chatIds: [history] });
      await db.doc('users/' + peer).update({ accountStatus: 'deleted' });
      assert.deepEqual(await request(), { chatIds: [] });
      assert.equal((await db.doc('chats/' + history).get()).exists, true);
    } finally {
      await Promise.all([owner, peer, outsider].map(uid => db.recursiveDelete(db.doc('users/' + uid))));
      await Promise.all([history, foreign].map(id => db.doc('chats/' + id).delete()));
      environment.cleanup();
    }
  });
});
