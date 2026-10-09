import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteField, doc, getDoc, setDoc, updateDoc, FieldPath } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const PROJECT_ID = 'demo-entretenimento-rules';
const CHAT_ID = 'reaction-chat';
const MESSAGE_ID = 'message-1';
const A = 'reaction-a';
const B = 'reaction-b';
const OUTSIDER = 'reaction-outsider';
let env: RulesTestEnvironment;

function activeUser(uid: string) {
  return {
    uid, profileCompleted: true, accountStatus: 'active',
    interactionBlocked: false, accountLocked: false, loginAllowed: true,
    acceptedTerms: { accepted: true, version: 'v3', acknowledgedPrivacyNotice: true },
    adultConsent: { accepted: true, version: 'v1' },
    ageReverification: { status: 'NONE' },
  };
}
function db(uid: string) {
  return env.authenticatedContext(uid, { email_verified: true }).firestore();
}
function message(uid: string) {
  return doc(db(uid), 'chats', CHAT_ID, 'messages', MESSAGE_ID);
}
async function seed(reactions?: Record<string, string>, deleted = false) {
  await env.withSecurityRulesDisabled(async (context) => {
    const admin = context.firestore();
    for (const uid of [A, B, OUTSIDER]) {
      await setDoc(doc(admin, 'users', uid), activeUser(uid));
      await setDoc(doc(admin, 'age_eligibility_records', uid), {
        uid, status: 'VERIFIED_ADULT', policyVersion: 1,
        source: 'AGE_REVERIFICATION', method: 'MANUAL_REVIEW',
        verifiedAt: new Date(Date.now() - 1000), expiresAt: null,
      });
    }
    await setDoc(doc(admin, 'chats', CHAT_ID), { participants: [A, B] });
    const initial: Record<string, unknown> = {
      senderId: A, content: 'hello', status: 'sent', deleted,
    };
    if (reactions !== undefined) initial['reactionsByUser'] = reactions;
    await setDoc(doc(admin, 'chats', CHAT_ID, 'messages', MESSAGE_ID), initial);
  });
}
async function write(uid: string, value: string | null) {
  return updateDoc(message(uid), new FieldPath('reactionsByUser', uid), value ?? deleteField());
}

describe('Firestore Rules / direct chat reactions', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        host: '127.0.0.1', port: 8180,
        rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
      },
    });
  });
  beforeEach(async () => { await env.clearFirestore(); await seed(); });
  afterAll(async () => { await env.cleanup(); });

  it('permite a primeira reação mesmo sem mapa inicial', async () => {
    await assertSucceeds(write(A, '❤️'));
    const snap = await assertSucceeds(getDoc(message(A)));
    expect(snap.data()?.['reactionsByUser']).toEqual({ [A]: '❤️' });
  });

  it('mantém reações dos dois participantes em escritas consecutivas por chave', async () => {
    await assertSucceeds(write(A, '❤️'));
    await assertSucceeds(write(B, '🔥'));
    const snap = await assertSucceeds(getDoc(message(A)));
    expect(snap.data()?.['reactionsByUser']).toEqual({ [A]: '❤️', [B]: '🔥' });
    await assertSucceeds(write(A, null));
    const after = await assertSucceeds(getDoc(message(B)));
    expect(after.data()?.['reactionsByUser']).toEqual({ [B]: '🔥' });
  });

  it('nega alteração da reação de outro participante', async () => {
    await assertSucceeds(write(A, '❤️'));
    await assertFails(updateDoc(message(B), new FieldPath('reactionsByUser', A), '😂'));
  });

  it('nega atualização de mapa completo que remova a reação alheia', async () => {
    await assertSucceeds(write(A, '❤️'));
    await assertFails(updateDoc(message(B), { reactionsByUser: { [B]: '🔥' } }));
  });

  it('nega leitura e reação ao não participante', async () => {
    await assertFails(getDoc(message(OUTSIDER)));
    await assertFails(write(OUTSIDER, '👀'));
  });

  it('nega reações com valor não aprovado', async () => {
    await assertFails(write(A, 'INVALID'));
  });

  it('nega reação em mensagem apagada', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'chats', CHAT_ID, 'messages', MESSAGE_ID), { deleted: true });
    });
    await assertFails(write(A, '❤️'));
  });

  it('nega reação de usuário não autenticado', async () => {
    const anonymous = env.unauthenticatedContext().firestore();
    await assertFails(updateDoc(
      doc(anonymous, 'chats', CHAT_ID, 'messages', MESSAGE_ID),
      new FieldPath('reactionsByUser', A), '❤️',
    ));
  });
});
