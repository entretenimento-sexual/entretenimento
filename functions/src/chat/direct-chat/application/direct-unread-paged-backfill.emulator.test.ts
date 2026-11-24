import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { db } from '../../../firebaseApp';
import { advanceShadowUnreadBackfillOnEmulator } from './direct-unread-paged-backfill.emulator';

const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
run('paged unread shadow scan', () => {
  it('resumes beyond 100 messages, serializes concurrent advances and preserves live projections', async () => {
    const id = 'paged-' + randomUUID();
    const chat = db.collection('chats').doc(id);
    const runRef = db.collection('direct_chat_unread_backfill_shadow_runs').doc(id);
    const projection = db.collection('direct_chat_unread_projections').doc('recipient').collection('chats').doc(id);
    try {
      await chat.set({ participants: ['sender', 'recipient'] });
      const batch = db.batch();
      for (let i = 0; i < 205; i++) batch.set(chat.collection('messages').doc(String(i).padStart(4, '0')), {
        senderId: 'sender', status: i % 5 === 0 ? 'read' : 'sent', content: 'private',
      });
      await batch.commit();
      await projection.set({ unreadCount: 999 });
      const first = await advanceShadowUnreadBackfillOnEmulator(id, id);
      assert.equal(first.scanned, 100);
      assert.equal(first.status, 'RUNNING');
      await Promise.all([advanceShadowUnreadBackfillOnEmulator(id, id), advanceShadowUnreadBackfillOnEmulator(id, id)]);
      const final = await advanceShadowUnreadBackfillOnEmulator(id, id);
      assert.equal(final.scanned, 205);
      assert.deepEqual(final.counts, [164, 0]);
      assert.equal(final.status, 'SCAN_COMPLETE');
      assert.equal(final.coverage, 'UNVERIFIED');
      assert.equal(final.advanced, false);
      assert.equal((await projection.get()).data()?.unreadCount, 999);
      assert.equal((await runRef.get()).data()?.content, undefined);
      await chat.update({ participants: ['sender', 'other'] });
      await assert.rejects(advanceShadowUnreadBackfillOnEmulator(id, id));
    } finally {
      await Promise.all([db.recursiveDelete(chat), runRef.delete(), projection.delete()]);
    }
  });
});
