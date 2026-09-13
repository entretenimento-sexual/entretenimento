// firestore-rules/tests/friendship-backend-authority.rules.spec.ts
// -----------------------------------------------------------------------------
// FIRESTORE SECURITY RULES - FRIENDSHIP BACKEND AUTHORITY
// -----------------------------------------------------------------------------
// Garante que o navegador nunca se torne autoridade de amizade, requests,
// cooldowns ou bloqueios. Cloud Functions/Admin SDK continuam fora das Rules.
// -----------------------------------------------------------------------------
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  it,
} from 'vitest';

const PROJECT_ID = 'demo-entretenimento-rules';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8180;
const ALICE_UID = 'friendship-alice';
const BOB_UID = 'friendship-bob';
const OUTSIDER_UID = 'friendship-outsider';
const REQUEST_ID = 'friendship-request-001';

let testEnv: RulesTestEnvironment;

function authenticatedDb(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}

async function seedCanonicalState(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, 'friendRequests', REQUEST_ID), {
      requesterUid: ALICE_UID,
      targetUid: BOB_UID,
      status: 'pending',
    });

    await setDoc(doc(db, 'users', ALICE_UID, 'friends', BOB_UID), {
      friendUid: BOB_UID,
      since: new Date('2026-09-12T12:00:00.000Z'),
      lastInteractionAt: new Date('2026-09-12T12:00:00.000Z'),
    });

    await setDoc(doc(db, 'users', ALICE_UID, 'blocks', BOB_UID), {
      uid: BOB_UID,
      isBlocked: true,
    });

    await setDoc(doc(db, 'friendCooldowns', `${ALICE_UID}__${BOB_UID}`), {
      requesterUid: ALICE_UID,
      targetUid: BOB_UID,
      until: new Date('2026-09-13T12:00:00.000Z'),
    });

    await setDoc(doc(db, 'friends', `${ALICE_UID}_${BOB_UID}`), {
      participants: [ALICE_UID, BOB_UID],
      legacy: true,
    });
  });
}

describe('Firestore Rules / friendship backend authority', () => {
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
    await seedCanonicalState();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('mantém as leituras privadas necessárias para requests e arestas canônicas', async () => {
    const aliceDb = authenticatedDb(ALICE_UID);
    const bobDb = authenticatedDb(BOB_UID);
    const outsiderDb = authenticatedDb(OUTSIDER_UID);

    await assertSucceeds(getDoc(doc(aliceDb, 'friendRequests', REQUEST_ID)));
    await assertSucceeds(getDoc(doc(bobDb, 'friendRequests', REQUEST_ID)));
    await assertFails(getDoc(doc(outsiderDb, 'friendRequests', REQUEST_ID)));

    await assertSucceeds(
      getDoc(doc(aliceDb, 'users', ALICE_UID, 'friends', BOB_UID))
    );
    await assertFails(
      getDoc(doc(bobDb, 'users', ALICE_UID, 'friends', BOB_UID))
    );
  });

  it('nega create, update e delete de friendRequests pelo cliente', async () => {
    const aliceDb = authenticatedDb(ALICE_UID);
    const existingRef = doc(aliceDb, 'friendRequests', REQUEST_ID);
    const newRef = doc(aliceDb, 'friendRequests', 'friendship-request-002');

    await assertFails(
      setDoc(newRef, {
        requesterUid: ALICE_UID,
        targetUid: BOB_UID,
        status: 'pending',
      })
    );
    await assertFails(updateDoc(existingRef, { status: 'accepted' }));
    await assertFails(deleteDoc(existingRef));
  });

  it('nega create, update e delete das arestas users/{uid}/friends pelo cliente', async () => {
    const aliceDb = authenticatedDb(ALICE_UID);
    const existingRef = doc(
      aliceDb,
      'users',
      ALICE_UID,
      'friends',
      BOB_UID
    );
    const newRef = doc(
      aliceDb,
      'users',
      ALICE_UID,
      'friends',
      OUTSIDER_UID
    );

    await assertFails(setDoc(newRef, { friendUid: OUTSIDER_UID }));
    await assertFails(updateDoc(existingRef, { source: 'client' }));
    await assertFails(deleteDoc(existingRef));
  });

  it('nega qualquer escrita na coleção raiz legada /friends', async () => {
    const aliceDb = authenticatedDb(ALICE_UID);
    const existingRef = doc(aliceDb, 'friends', `${ALICE_UID}_${BOB_UID}`);
    const newRef = doc(aliceDb, 'friends', `${ALICE_UID}_${OUTSIDER_UID}`);

    await assertSucceeds(getDoc(existingRef));
    await assertFails(
      setDoc(newRef, { participants: [ALICE_UID, OUTSIDER_UID] })
    );
    await assertFails(updateDoc(existingRef, { legacy: false }));
    await assertFails(deleteDoc(existingRef));
  });

  it('nega escrita client-side de cooldown e bloqueio', async () => {
    const aliceDb = authenticatedDb(ALICE_UID);
    const cooldownRef = doc(
      aliceDb,
      'friendCooldowns',
      `${ALICE_UID}__${BOB_UID}`
    );
    const blockRef = doc(aliceDb, 'users', ALICE_UID, 'blocks', BOB_UID);

    await assertFails(
      setDoc(doc(aliceDb, 'friendCooldowns', `${ALICE_UID}__${OUTSIDER_UID}`), {
        requesterUid: ALICE_UID,
        targetUid: OUTSIDER_UID,
      })
    );
    await assertFails(updateDoc(cooldownRef, { bypass: true }));
    await assertFails(deleteDoc(cooldownRef));

    await assertFails(
      setDoc(doc(aliceDb, 'users', ALICE_UID, 'blocks', OUTSIDER_UID), {
        uid: OUTSIDER_UID,
        isBlocked: true,
      })
    );
    await assertFails(updateDoc(blockRef, { isBlocked: false }));
    await assertFails(deleteDoc(blockRef));
  });
});
