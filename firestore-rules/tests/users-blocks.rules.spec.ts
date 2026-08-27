// firestore-rules/tests/users-blocks.rules.spec.ts
// -----------------------------------------------------------------------------
// FIRESTORE SECURITY RULES - USER BLOCKS
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
  serverTimestamp,
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
const OWNER_UID = 'block-owner-user';
const TARGET_UID = 'block-target-user';
const OUTSIDER_UID = 'block-outsider-user';
const EVENT_ID = 'block-event-001';

let testEnv: RulesTestEnvironment;

function authenticatedDb(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}

function blockState() {
  return {
    uid: TARGET_UID,
    isBlocked: true,
    blockedAt: serverTimestamp(),
    reason: 'Proteção do usuário',
    actorUid: OWNER_UID,
    updatedAt: serverTimestamp(),
  };
}

function blockEvent() {
  return {
    type: 'block',
    actorUid: OWNER_UID,
    targetUid: TARGET_UID,
    reason: 'Proteção do usuário',
    createdAt: serverTimestamp(),
  };
}

async function seedBlockWithEvent(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const blockRef = doc(db, 'users', OWNER_UID, 'blocks', TARGET_UID);
    const eventRef = doc(blockRef, 'events', EVENT_ID);

    await setDoc(blockRef, blockState());
    await setDoc(eventRef, blockEvent());
  });
}

describe('Firestore Rules / user blocks', () => {
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
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('permite ao proprietário ler estado e eventos criados pelo backend', async () => {
    await seedBlockWithEvent();
    const db = authenticatedDb(OWNER_UID);
    const blockRef = doc(db, 'users', OWNER_UID, 'blocks', TARGET_UID);
    const eventRef = doc(blockRef, 'events', EVENT_ID);

    await assertSucceeds(getDoc(blockRef));
    await assertSucceeds(getDoc(eventRef));
  });

  it('nega leitura do bloqueio a outro usuário', async () => {
    await seedBlockWithEvent();
    const outsiderDb = authenticatedDb(OUTSIDER_UID);
    const blockRef = doc(
      outsiderDb,
      'users',
      OWNER_UID,
      'blocks',
      TARGET_UID
    );
    const eventRef = doc(blockRef, 'events', EVENT_ID);

    await assertFails(getDoc(blockRef));
    await assertFails(getDoc(eventRef));
  });

  it('nega create, update e delete do estado diretamente pelo cliente', async () => {
    const db = authenticatedDb(OWNER_UID);
    const blockRef = doc(db, 'users', OWNER_UID, 'blocks', TARGET_UID);

    await assertFails(setDoc(blockRef, blockState()));

    await seedBlockWithEvent();
    await assertFails(updateDoc(blockRef, { isBlocked: false }));
    await assertFails(deleteDoc(blockRef));
  });

  it('nega qualquer escrita de evento diretamente pelo cliente', async () => {
    await seedBlockWithEvent();
    const db = authenticatedDb(OWNER_UID);
    const blockRef = doc(db, 'users', OWNER_UID, 'blocks', TARGET_UID);
    const existingEventRef = doc(blockRef, 'events', EVENT_ID);
    const newEventRef = doc(blockRef, 'events', 'block-event-002');

    await assertFails(setDoc(newEventRef, blockEvent()));
    await assertFails(updateDoc(existingEventRef, { reason: 'alterado' }));
    await assertFails(deleteDoc(existingEventRef));
  });
});
