// firestore-rules/tests/invites.rules.spec.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

const PROJECT_ID = 'demo-entretenimento-rules';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8180;

const SENDER_UID = 'invite-sender';
const RECEIVER_UID = 'invite-receiver';
const OUTSIDER_UID = 'invite-outsider';
const ROOM_ID = 'invite-room-001';
const INVITE_ID = `room:${ROOM_ID}:to:${RECEIVER_UID}`;

let testEnv: RulesTestEnvironment;

function activeUser(uid: string): Record<string, unknown> {
  return {
    uid,
    profileCompleted: true,
    accountStatus: 'active',
    interactionBlocked: false,
    accountLocked: false,
    loginAllowed: true,
  };
}

function authenticatedDb(uid: string) {
  return testEnv
    .authenticatedContext(uid, { email_verified: true })
    .firestore();
}

async function seedDatabase(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await Promise.all([
      setDoc(doc(db, 'users', SENDER_UID), activeUser(SENDER_UID)),
      setDoc(doc(db, 'users', RECEIVER_UID), activeUser(RECEIVER_UID)),
      setDoc(doc(db, 'users', OUTSIDER_UID), activeUser(OUTSIDER_UID)),
      setDoc(doc(db, 'rooms', ROOM_ID), {
        roomName: 'Sala por convite',
        createdBy: SENDER_UID,
        participants: [SENDER_UID],
        memberCount: 1,
        status: 'active',
        lastActivity: new Date(),
      }),
      setDoc(doc(db, 'invites', INVITE_ID), {
        type: 'room',
        targetId: ROOM_ID,
        targetName: 'Sala por convite',
        roomId: ROOM_ID,
        roomName: 'Sala por convite',
        senderId: SENDER_UID,
        receiverId: RECEIVER_UID,
        status: 'pending',
        sentAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ]);
  });
}

describe('Firestore Rules / invites backend response boundary', () => {
  beforeAll(async () => {
    const rules = readFileSync(
      resolve(process.cwd(), 'firestore.rules'),
      'utf8'
    );

    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        host: FIRESTORE_HOST,
        port: FIRESTORE_PORT,
        rules,
      },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await seedDatabase();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('permite ao receiver consultar somente seu inbox pendente', async () => {
    const db = authenticatedDb(RECEIVER_UID);
    const inboxQuery = query(
      collection(db, 'invites'),
      where('receiverId', '==', RECEIVER_UID),
      where('status', '==', 'pending'),
      orderBy('sentAt', 'desc'),
      limit(50)
    );

    const snapshot = await assertSucceeds(getDocs(inboxQuery));
    expect(snapshot.docs.map((item) => item.id)).toEqual([INVITE_ID]);
  });

  it('nega leitura do convite para terceiro', async () => {
    const db = authenticatedDb(OUTSIDER_UID);
    await assertFails(getDoc(doc(db, 'invites', INVITE_ID)));
  });

  it('nega criação direta mesmo para o owner da sala', async () => {
    const db = authenticatedDb(SENDER_UID);
    const receiverId = 'second-receiver';
    const inviteId = `room:${ROOM_ID}:to:${receiverId}`;

    await assertFails(
      setDoc(doc(db, 'invites', inviteId), {
        type: 'room',
        targetId: ROOM_ID,
        targetName: 'Sala por convite',
        roomId: ROOM_ID,
        roomName: 'Sala por convite',
        senderId: SENDER_UID,
        receiverId,
        status: 'pending',
        sentAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      })
    );
  });

  it('nega accepted/declined direto pelo receiver', async () => {
    const db = authenticatedDb(RECEIVER_UID);

    await assertFails(
      updateDoc(doc(db, 'invites', INVITE_ID), {
        status: 'accepted',
        respondedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('nega entrada direta na sala mesmo com convite pendente válido', async () => {
    const db = authenticatedDb(RECEIVER_UID);

    await assertFails(
      updateDoc(doc(db, 'rooms', ROOM_ID), {
        participants: [SENDER_UID, RECEIVER_UID],
        lastActivity: serverTimestamp(),
      })
    );
  });

  it('preserva cancelamento direto pelo sender enquanto pending', async () => {
    const db = authenticatedDb(SENDER_UID);

    await assertSucceeds(
      updateDoc(doc(db, 'invites', INVITE_ID), {
        status: 'canceled',
        updatedAt: serverTimestamp(),
      })
    );
  });
});
