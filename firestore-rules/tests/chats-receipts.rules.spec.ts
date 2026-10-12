import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, setDoc, startAfter, updateDoc } from 'firebase/firestore';
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

  it('nega leitura e recibo sem autenticação ou por terceiro', async () => {
    const anonymous = env.unauthenticatedContext().firestore();
    const ref = doc(anonymous, 'chats', CHAT_ID, 'messages', MESSAGE_ID);
    await assertFails(getDoc(ref));
    await assertFails(updateDoc(ref, { status: 'delivered' }));
    await assertFails(getDoc(message(OUTSIDER)));
  });

  it('nega adulteração da identidade e dos campos autoritativos pelo destinatário', async () => {
    for (const patch of [
      { senderId: RECIPIENT },
      { content: 'texto adulterado' },
      { deleted: true },
      { status: 'delivered', senderId: RECIPIENT },
    ]) {
      await assertFails(updateDoc(message(RECIPIENT), patch));
    }
    const final = await assertSucceeds(getDoc(message(SENDER)));
    expect(final.data()?.['senderId']).toBe(SENDER);
    expect(final.data()?.['status']).toBe('sent');
    expect(final.data()?.['deleted']).toBe(false);
  });

  it('revoga recibo com a mesma sessão após suspensão do destinatário', async () => {
    const currentSession = message(RECIPIENT);
    await assertSucceeds(getDoc(currentSession));
    await env.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'users', RECIPIENT), {
        accountStatus: 'suspended', loginAllowed: false,
      });
    });
    await assertFails(updateDoc(currentSession, { status: 'delivered' }));
  });

  it.each([
    [SENDER, RECIPIENT],
    [RECIPIENT, SENDER],
  ])('revoga leitura e recibos após bloqueio de %s para %s', async (owner, target) => {
    const existingSession = message(RECIPIENT);
    await assertSucceeds(getDoc(existingSession));

    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', owner, 'blocks', target), {
        uid: target, isBlocked: true, actorUid: owner,
        blockedAt: new Date(), updatedAt: new Date(),
      });
    });

    await assertFails(getDoc(existingSession));
    await assertFails(updateDoc(existingSession, { status: 'delivered' }));
  });

  it('revoga leitura de mensagens após suspensão sem trocar a sessão', async () => {
    const existingSession = message(RECIPIENT);
    await assertSucceeds(getDoc(existingSession));
    await env.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'users', RECIPIENT), {
        accountStatus: 'suspended', loginAllowed: false,
      });
    });
    await assertFails(getDoc(existingSession));
    await assertFails(updateDoc(existingSession, { status: 'delivered' }));
  });

  it('nega leitura e escrita quando chat direto perde a dupla de participantes', async () => {
    const existingSession = message(RECIPIENT);
    await assertSucceeds(getDoc(existingSession));
    await env.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'chats', CHAT_ID), {
        participants: [SENDER],
      });
    });
    await assertFails(getDoc(existingSession));
    await assertFails(updateDoc(existingSession, { status: 'delivered' }));
    // Um chat direto exige exatamente dois participantes: nenhum dos lados
    // continua autorizado enquanto o documento estiver estruturalmente inválido.
    await assertFails(getDoc(message(SENDER)));
  });

  it.each(['remoção', 'suspensão', 'bloqueio do remetente', 'bloqueio do destinatário'])(
    'impede página seguinte após %s',
    async (revocation) => {
    const currentSession = env.authenticatedContext(
      RECIPIENT, { email_verified: true }
    ).firestore();
    await env.withSecurityRulesDisabled(async (context) => {
      const admin = context.firestore();
      await setDoc(doc(admin, 'chats', CHAT_ID, 'messages', 'older-page'), {
        senderId: SENDER, content: 'anterior', status: 'sent',
        deleted: false, timestamp: new Date(1000),
      });
      await updateDoc(doc(admin, 'chats', CHAT_ID, 'messages', MESSAGE_ID), {
        timestamp: new Date(2000),
      });
    });
    const messages = collection(currentSession, 'chats', CHAT_ID, 'messages');
    const first = await assertSucceeds(getDocs(query(
      messages, orderBy('timestamp', 'desc'), limit(1)
    )));
    expect(first.docs).toHaveLength(1);
    await env.withSecurityRulesDisabled(async (context) => {
      const admin = context.firestore();
      if (revocation === 'remoção') {
        await updateDoc(doc(admin, 'chats', CHAT_ID), { participants: [SENDER] });
      } else if (revocation === 'suspensão') {
        await updateDoc(doc(admin, 'users', RECIPIENT), {
          accountStatus: 'suspended', loginAllowed: false,
        });
      } else {
        const owner = revocation === 'bloqueio do remetente' ? SENDER : RECIPIENT;
        const target = owner === SENDER ? RECIPIENT : SENDER;
        await setDoc(doc(admin, 'users', owner, 'blocks', target), {
          uid: target, isBlocked: true, actorUid: owner,
          blockedAt: new Date(), updatedAt: new Date(),
        });
      }
    });
    await assertFails(getDocs(query(
      messages, orderBy('timestamp', 'desc'), startAfter(first.docs[0]), limit(1)
    )));
  });

  it('desbloqueio não reabre mensagens enquanto a conta permanece suspensa', async () => {
    const session = message(RECIPIENT);
    await assertSucceeds(getDoc(session));
    await env.withSecurityRulesDisabled(async (context) => {
      const admin = context.firestore();
      await setDoc(doc(admin, 'users', SENDER, 'blocks', RECIPIENT), {
        uid: RECIPIENT, isBlocked: true, actorUid: SENDER,
        blockedAt: new Date(), updatedAt: new Date(),
      });
      await updateDoc(doc(admin, 'users', RECIPIENT), {
        accountStatus: 'suspended', loginAllowed: false,
      });
    });
    await assertFails(getDoc(session));
    await env.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'users', SENDER, 'blocks', RECIPIENT), {
        isBlocked: false, updatedAt: new Date(),
      });
    });
    await assertFails(getDoc(session));
    await assertFails(updateDoc(session, { status: 'delivered' }));
  });

  it('preserva leitura do histórico depois de desfazer amizade bilateral', async () => {
    const recipientMessage = message(RECIPIENT);
    await assertSucceeds(getDoc(recipientMessage));
    await env.withSecurityRulesDisabled(async (context) => {
      const admin = context.firestore();
      await setDoc(doc(admin, 'users', SENDER, 'friends', RECIPIENT), {
        accepted: true,
      });
      await setDoc(doc(admin, 'users', RECIPIENT, 'friends', SENDER), {
        accepted: true,
      });
    });
    await assertSucceeds(getDoc(recipientMessage));
    await env.withSecurityRulesDisabled(async (context) => {
      const admin = context.firestore();
      await Promise.all([
        deleteDoc(doc(admin, 'users', SENDER, 'friends', RECIPIENT)),
        deleteDoc(doc(admin, 'users', RECIPIENT, 'friends', SENDER)),
      ]);
    });
    await assertSucceeds(getDoc(recipientMessage));
    await assertSucceeds(getDoc(message(SENDER)));
  });

  it('preserva leitura de histórico com vínculo de amizade unilateral', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const admin = context.firestore();
      await setDoc(doc(admin, 'users', SENDER, 'friends', RECIPIENT), {
        accepted: true,
      });
    });
    await assertSucceeds(getDoc(message(SENDER)));
    await assertSucceeds(getDoc(message(RECIPIENT)));
    await env.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(context.firestore(), 'users', SENDER, 'friends', RECIPIENT));
    });
    await assertSucceeds(getDoc(message(SENDER)));
    await assertSucceeds(getDoc(message(RECIPIENT)));
  });

  it('mantém o mesmo histórico após desfazer e restabelecer amizade bilateral', async () => {
    const existingChat = doc(
      env.authenticatedContext(SENDER, { email_verified: true }).firestore(),
      'chats', CHAT_ID
    );
    const before = await assertSucceeds(getDoc(existingChat));
    await env.withSecurityRulesDisabled(async (context) => {
      const admin = context.firestore();
      await setDoc(doc(admin, 'users', SENDER, 'friends', RECIPIENT), {
        accepted: true,
      });
      await setDoc(doc(admin, 'users', RECIPIENT, 'friends', SENDER), {
        accepted: true,
      });
    });
    await assertSucceeds(getDoc(message(RECIPIENT)));
    await env.withSecurityRulesDisabled(async (context) => {
      const admin = context.firestore();
      await Promise.all([
        deleteDoc(doc(admin, 'users', SENDER, 'friends', RECIPIENT)),
        deleteDoc(doc(admin, 'users', RECIPIENT, 'friends', SENDER)),
      ]);
    });
    await assertSucceeds(getDoc(message(RECIPIENT)));
    await env.withSecurityRulesDisabled(async (context) => {
      const admin = context.firestore();
      await setDoc(doc(admin, 'users', SENDER, 'friends', RECIPIENT), {
        accepted: true,
      });
      await setDoc(doc(admin, 'users', RECIPIENT, 'friends', SENDER), {
        accepted: true,
      });
    });
    const after = await assertSucceeds(getDoc(existingChat));
    expect(after.id).toBe(before.id);
    expect(after.data()?.['participants']).toEqual([SENDER, RECIPIENT]);
    await assertSucceeds(getDoc(message(RECIPIENT)));
  });

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
