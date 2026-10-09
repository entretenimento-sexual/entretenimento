import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const PROJECT_ID = 'demo-entretenimento-rules';
const CHAT_ID = 'receipt-chat';
const MESSAGE_ID = 'receipt-message';
const SENDER = 'receipt-sender';
const RECIPIENT = 'receipt-recipient';
const OUTSIDER = 'receipt-outsider';

let env: RulesTestEnvironment;

function activeUser(uid: string) {
  return {
    uid, profileCompleted: true, accountStatus: 'active',
    interactionBlocked: false, accountLocked: false, loginAllowed: true,
    acceptedTerms: {
      accepted: true, version: 'v3', acknowledgedPrivacyNotice: true,
    },
    adultConsent: { accepted: true, version: 'v1' },
    ageReverification: { status: 'NONE' },
  };
}

function message(uid: string) {
  const client = env.authenticatedContext(
    uid, { email_verified: true }
  ).firestore();
  return doc(client, 'chats', CHAT_ID, 'messages', MESSAGE_ID);
}

async function adminUpdate(patch: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (context) => {
    await updateDoc(
      doc(context.firestore(), 'chats', CHAT_ID, 'messages', MESSAGE_ID),
      patch
    );
  });
}

describe('Firestore Rules / direct chat receipts', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        host: '127.0.0.1', port: 8180,
        rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
      },
    });
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (context) => {
      const admin = context.firestore();
      for (const uid of [SENDER, RECIPIENT, OUTSIDER]) {
        await setDoc(doc(admin, 'users', uid), activeUser(uid));
        await setDoc(doc(admin, 'age_eligibility_records', uid), {
          uid, status: 'VERIFIED_ADULT', policyVersion: 1,
          source: 'AGE_REVERIFICATION', method: 'MANUAL_REVIEW',
          verifiedAt: new Date(Date.now() - 1000), expiresAt: null,
        });
      }
      await setDoc(doc(admin, 'chats', CHAT_ID), {
        participants: [SENDER, RECIPIENT],
      });
      await setDoc(
        doc(admin, 'chats', CHAT_ID, 'messages', MESSAGE_ID),
        { senderId: SENDER, content: 'olá', status: 'sent', deleted: false }
      );
    });
  });

  afterAll(async () => { await env.cleanup(); });

  it('permite avanço sequencial sent -> delivered -> read', async () => {
    await assertSucceeds(updateDoc(message(RECIPIENT), { status: 'delivered' }));
    await assertSucceeds(updateDoc(message(RECIPIENT), { status: 'read' }));
    expect((await getDoc(message(RECIPIENT))).data()?.['status']).toBe('read');
  });

  it('nega saltos, retrocessos e atualização pelo remetente', async () => {
    await assertFails(updateDoc(message(RECIPIENT), { status: 'read' }));
    await assertFails(updateDoc(message(SENDER), { status: 'delivered' }));
    await assertSucceeds(updateDoc(message(RECIPIENT), { status: 'delivered' }));
    await assertFails(updateDoc(message(RECIPIENT), { status: 'sent' }));
    await assertSucceeds(updateDoc(message(RECIPIENT), { status: 'read' }));
    await assertFails(updateDoc(message(RECIPIENT), { status: 'delivered' }));
  });

  it('nega atualização por não participante e alteração de outro campo', async () => {
    await assertFails(updateDoc(message(OUTSIDER), { status: 'delivered' }));
    await assertFails(updateDoc(message(RECIPIENT), {
      status: 'delivered', content: 'adulterado',
    }));
  });

  it('nega qualquer avanço de recibo após exclusão confirmada', async () => {
    await adminUpdate({ deleted: true, reactionsByUser: {} });
    await assertFails(updateDoc(message(RECIPIENT), { status: 'delivered' }));
    const final = await getDoc(message(RECIPIENT));
    expect(final.data()?.['deleted']).toBe(true);
    expect(final.data()?.['status']).toBe('sent');
  });

  it('nega delivered -> read se a exclusão ocorreu após delivered', async () => {
    await assertSucceeds(updateDoc(message(RECIPIENT), { status: 'delivered' }));
    await adminUpdate({ deleted: true });
    await assertFails(updateDoc(message(RECIPIENT), { status: 'read' }));
    const final = await getDoc(message(RECIPIENT));
    expect(final.data()?.['status']).toBe('delivered');
    expect(final.data()?.['deleted']).toBe(true);
  });

  it('exclusão concorrente com recibo mantém tombstone e bloqueia novo avanço', async () => {
    const outcomes = await Promise.allSettled([
      adminUpdate({ deleted: true, reactionsByUser: {} }),
      updateDoc(message(RECIPIENT), { status: 'delivered' }),
    ]);
    expect(outcomes[0].status).toBe('fulfilled');
    const final = (await getDoc(message(RECIPIENT))).data();
    expect(final?.['deleted']).toBe(true);
    expect(['sent', 'delivered']).toContain(final?.['status']);
    expect(final?.['reactionsByUser']).toEqual({});
    await assertFails(updateDoc(message(RECIPIENT), { status: 'read' }));
  });

  it('recibos concorrentes não produzem salto ou regressão', async () => {
    const results = await Promise.allSettled([
      updateDoc(message(RECIPIENT), { status: 'delivered' }),
      updateDoc(message(RECIPIENT), { status: 'read' }),
    ]);
    const current = (await getDoc(message(RECIPIENT))).data()?.['status'];
    expect(['delivered', 'read']).toContain(current);
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    if (current === 'read') {
      expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    }
  });
});
