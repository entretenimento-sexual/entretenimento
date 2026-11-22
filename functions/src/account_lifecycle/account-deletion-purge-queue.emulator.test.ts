import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { reserveAccountDeletionPurgeBatch } from './account-deletion-purge-queue.firestore';
import { db } from '../firebaseApp';

assert.equal(process.env.GCLOUD_PROJECT, 'demo-entretenimento-purge-queue');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8180');

after(async () => { await db.terminate(); });

test('a fila avança após páginas de retenções, retries e leases e retoma o cursor após o limite', async () => {
  const now = 1_800_000_000_000;
  const startsAt = now - 1;
  const users = db.collection('users');
  const blocked = [
    { legalHold: true },
    { billingHold: true },
    { purgeNextAttemptAt: now + 10_000 },
    { purgeLeaseOwner: 'run-in-progress', purgeLeaseUntil: now + 10_000 },
    { accountStatus: 'active' },
  ];

  for (let start = 0; start < 1_000; start += 200) {
    const writes = db.batch();
    for (let offset = 0; offset < 200; offset++) {
      const index = start + offset;
      writes.set(users.doc(`blocked-${String(index).padStart(4, '0')}`), {
        accountStatus: 'pending_deletion',
        purgeAfter: startsAt,
        ...blocked[index % blocked.length],
      });
    }
    await writes.commit();
  }
  await users.doc('eligible').set({ accountStatus: 'pending_deletion', purgeAfter: startsAt });
  await users.doc('later').set({ accountStatus: 'pending_deletion', purgeAfter: now + 1 });

  const first = await reserveAccountDeletionPurgeBatch(now);
  assert.ok(first);
  assert.equal(first.scanned, 1_000);
  assert.deepEqual(first.candidates, []);
  assert.equal(first.exhausted, false);

  const resumed = await reserveAccountDeletionPurgeBatch(now + 2);
  assert.ok(resumed);
  assert.deepEqual(resumed.candidates.map(doc => doc.id), ['eligible']);
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.exhausted, true);

  await users.doc('blocked-0000').update({ legalHold: false });

  const nextSweep = await reserveAccountDeletionPurgeBatch(now + 2);
  assert.ok(nextSweep);
  assert.equal(nextSweep.resumed, false);
  assert.deepEqual(nextSweep.candidates.map(doc => doc.id), ['blocked-0000']);

  const laterBatch = await reserveAccountDeletionPurgeBatch(now + 2);
  assert.ok(laterBatch);
  assert.deepEqual(laterBatch.candidates.map(doc => doc.id), ['eligible', 'later']);
});
