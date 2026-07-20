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

  it('permite criar evento quando o estado de bloqueio existe', async () => {
    const db = authenticatedDb(OWNER_UID);
    const blockRef = doc(db, 'users', OWNER_UID, 'blocks', TARGET_UID);
    const eventRef = doc(blockRef, 'events', EVENT_ID);

    await assertSucceeds(setDoc(blockRef, blockState()));
    await assertSucceeds(setDoc(eventRef, blockEvent()));
  });

  it('nega evento órfão quando o estado de bloqueio não existe', async () => {
    const db = authenticatedDb(OWNER_UID);
    const eventRef = doc(
      db,
      'users',
      OWNER_UID,
      'blocks',
      TARGET_UID,
      'events',
      EVENT_ID
    );

    await assertFails(setDoc(eventRef, blockEvent()));
  });

  it('nega criação de evento por usuário diferente do proprietário', async () => {
    const ownerDb = authenticatedDb(OWNER_UID);
    const outsiderDb = authenticatedDb(OUTSIDER_UID);
    const blockRef = doc(
      ownerDb,
      'users',
      OWNER_UID,
      'blocks',
      TARGET_UID
    );
    const eventRef = doc(
      outsiderDb,
      'users',
      OWNER_UID,
      'blocks',
      TARGET_UID,
      'events',
      EVENT_ID
    );

    await assertSucceeds(setDoc(blockRef, blockState()));
    await assertFails(setDoc(eventRef, blockEvent()));
  });

  it('mantém eventos imutáveis depois de criados', async () => {
    const db = authenticatedDb(OWNER_UID);
    const blockRef = doc(db, 'users', OWNER_UID, 'blocks', TARGET_UID);
    const eventRef = doc(blockRef, 'events', EVENT_ID);

    await assertSucceeds(setDoc(blockRef, blockState()));
    await assertSucceeds(setDoc(eventRef, blockEvent()));
    await assertFails(updateDoc(eventRef, { reason: 'alterado' }));
    await assertFails(deleteDoc(eventRef));
  });
});
