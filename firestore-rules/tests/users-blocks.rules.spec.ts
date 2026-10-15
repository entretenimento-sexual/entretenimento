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

  it('permite apenas get da própria projeção de acesso bilateral', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'direct_chat_access', OWNER_UID, 'peers', TARGET_UID),
        { available: false, version: 1, updatedAt: serverTimestamp() }
      );
    });
    const ownerRef = doc(
      authenticatedDb(OWNER_UID), 'direct_chat_access', OWNER_UID, 'peers', TARGET_UID
    );
    const outsiderRef = doc(
      authenticatedDb(OUTSIDER_UID), 'direct_chat_access', OWNER_UID, 'peers', TARGET_UID
    );

    await assertSucceeds(getDoc(ownerRef));
    await assertFails(getDoc(outsiderRef));
    await assertFails(updateDoc(ownerRef, { available: true }));
    await assertFails(deleteDoc(ownerRef));
    await assertFails(setDoc(
      doc(authenticatedDb(OWNER_UID), 'direct_chat_access', OWNER_UID, 'peers', OUTSIDER_UID),
      { available: true, version: 1 }
    ));
  });

  it('projeção de mídia permite somente get próprio, nunca mutação ou lista', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'public_media_access', OWNER_UID, 'owners', TARGET_UID),
        { available: false, version: 1, updatedAt: serverTimestamp() }
      );
    });
    const ownerRef = doc(
      authenticatedDb(OWNER_UID), 'public_media_access', OWNER_UID, 'owners', TARGET_UID
    );
    const outsiderRef = doc(
      authenticatedDb(OUTSIDER_UID), 'public_media_access', OWNER_UID, 'owners', TARGET_UID
    );
    const reverseRef = doc(
      authenticatedDb(TARGET_UID), 'public_media_access', OWNER_UID, 'owners', TARGET_UID
    );

    await assertSucceeds(getDoc(ownerRef));
    await assertFails(getDoc(outsiderRef));
    await assertFails(getDoc(reverseRef));
    await assertFails(updateDoc(ownerRef, { available: true }));
    await assertFails(deleteDoc(ownerRef));
    await assertFails(setDoc(
      doc(authenticatedDb(OWNER_UID), 'public_media_access', OWNER_UID, 'owners', OUTSIDER_UID),
      { available: true, version: 1 }
    ));
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
