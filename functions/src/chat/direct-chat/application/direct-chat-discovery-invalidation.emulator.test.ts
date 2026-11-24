import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { db } from '../../../firebaseApp';
import { invalidateDirectChatPeers } from './direct-chat-discovery-invalidation.trigger';
import { stageDirectChatDiscoveryReferences } from './direct-chat-discovery.references';

const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
run('CHAT-R1.6 opaque invalidation', () => {
  it('increments both owners on creation and finds unindexed peers on lifecycle changes', async () => {
    const prefix = 'revision-' + randomUUID();
    const a = prefix + '-a', b = prefix + '-b', c = prefix + '-c';
    const chat = db.doc('chats/' + prefix);
    const root = (uid: string) => db.doc('direct_chat_discovery/' + uid);
    try {
      await Promise.all([a, b, c].map(uid => db.doc('users/' + uid).set({ accountStatus: 'active' })));
      await chat.set({ participants: [a, b] });
      await invalidateDirectChatPeers(a);
      assert.deepEqual((await root(b).get()).data(), { version: 1, revision: 1 });
      assert.equal((await root(c).get()).exists, false);
      await db.runTransaction(async tx => {
        stageDirectChatDiscoveryReferences(tx, [a, b], chat.id);
      });
      assert.deepEqual((await root(a).get()).data(), { version: 1, revision: 1 });
      assert.deepEqual((await root(b).get()).data(), { version: 1, revision: 2 });
      await invalidateDirectChatPeers(a);
      assert.deepEqual((await root(b).get()).data(), { version: 1, revision: 3 });
    } finally {
      await chat.delete();
      await Promise.all([a, b, c].flatMap(uid => [db.doc('users/' + uid).delete(), db.recursiveDelete(root(uid))]));
    }
  });
});
