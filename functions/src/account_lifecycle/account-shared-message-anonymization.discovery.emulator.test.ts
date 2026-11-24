import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { db } from '../firebaseApp';
import { FirestoreAccountDataDeletionFullAdapter } from './account-shared-message-anonymization.firestore';

const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

run('CHAT-R1.3 — lifecycle discovery cleanup (Firestore emulator)', () => {
  it('remove referências bilateralmente sem apagar mensagens compartilhadas', async () => {
    const suffix = randomUUID();
    const a = `purge-${suffix}-a`;
    const b = `purge-${suffix}-b`;
    const chat = db.collection('chats').doc(`purge-historical-${suffix}`);
    const message = chat.collection('messages').doc('preserved');
    const refs = [a, b].map(uid => db.doc(`direct_chat_discovery/${uid}/chats/${chat.id}`));
    const stale = db.doc(`direct_chat_discovery/${a}/chats/orphan-${suffix}`);
    try {
      await Promise.all([
        chat.set({ participants: [a, b] }),
        message.set({ text: 'shared-history' }),
        ...refs.map(ref => ref.set({ version: 1, chatId: chat.id })),
        stale.set({ version: 1, chatId: `orphan-${suffix}` }),
      ]);
      const adapter = new FirestoreAccountDataDeletionFullAdapter();
      assert.equal(await adapter.anonymizeDirectChatsPage(a, 10), 1);
      for (const ref of refs) assert.equal((await ref.get()).exists, false);
      assert.equal((await message.get()).data()?.['text'], 'shared-history');
      const participants = (await chat.get()).data()?.['participants'] as string[];
      assert.equal(participants.includes(a), false);
      assert.equal(participants.includes(b), true);

      assert.equal(await adapter.deleteDirectChatDiscoveryReferencesPage(a, 10), 1);
      assert.equal((await stale.get()).exists, false);
      assert.equal(await adapter.deleteDirectChatDiscoveryReferencesPage(a, 10), 0);
    } finally {
      await Promise.all([
        db.recursiveDelete(chat),
        ...refs.map(ref => ref.delete()),
        stale.delete(),
      ]);
    }
  });
});
