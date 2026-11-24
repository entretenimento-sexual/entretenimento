import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, describe, it } from 'node:test';
import { db } from '../../../firebaseApp';
import { rebuildShadowDirectUnreadGlobalOnEmulator } from './direct-unread-global.emulator';
import { buildShadowUnreadAggregate } from '../domain/direct-unread-global.policy';

const row = (id: string, uid: string, unreadCount: number) => ({
  id, data: { version: 1, chatId: id, participantUid: uid, unreadCount },
});

describe('shadow unread global policy', () => {
  it('sums only normalized participant projections and never certifies coverage', () => {
    assert.deepEqual(buildShadowUnreadAggregate('me', [row('a', 'me', 3), row('b', 'me', 2)]), {
      version: 1, participantUid: 'me', projectedChatCount: 2,
      projectedUnreadCount: 5, coverage: 'UNVERIFIED',
    });
  });
  it('rejects malformed, foreign, duplicated, overflowing and oversized inputs', () => {
    for (const rows of [
      [row('a', 'other', 1)], [row('a', 'me', -1)],
      [row('a', 'me', 1), row('a', 'me', 1)],
      [row('a', 'me', Number.MAX_SAFE_INTEGER), row('b', 'me', 1)],
      Array.from({ length: 101 }, (_, i) => row(String(i), 'me', 1)),
    ]) assert.throws(() => buildShadowUnreadAggregate('me', rows));
  });
});

const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
run('shadow unread aggregate transactional materialization', () => {
  const uid = 'shadow-' + randomUUID();
  const root = db.collection('direct_chat_unread_projections').doc(uid);
  after(async () => { await db.recursiveDelete(root); });
  it('rebuilds idempotently and rejects invalid sources without overwriting previous aggregate', async () => {
    await root.collection('chats').doc('a').set(row('a', uid, 3).data);
    await root.collection('chats').doc('b').set(row('b', uid, 2).data);
    const first = await rebuildShadowDirectUnreadGlobalOnEmulator(uid);
    assert.equal(first.projectedUnreadCount, 5);
    assert.equal(first.changed, true);
    assert.equal((await rebuildShadowDirectUnreadGlobalOnEmulator(uid)).changed, false);
    await root.collection('chats').doc('a').update({ unreadCount: 1 });
    assert.equal((await rebuildShadowDirectUnreadGlobalOnEmulator(uid)).projectedUnreadCount, 3);
    await root.collection('chats').doc('b').update({ participantUid: 'foreign' });
    await assert.rejects(rebuildShadowDirectUnreadGlobalOnEmulator(uid));
    assert.equal((await root.get()).data()?.projectedUnreadCount, 3);
    assert.equal((await root.get()).data()?.coverage, 'UNVERIFIED');
  });
});
