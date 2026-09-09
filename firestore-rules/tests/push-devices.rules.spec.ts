import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  it,
} from 'vitest';

const PROJECT_ID = 'demo-push-devices-rules';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8180;
const OWNER_UID = 'push-device-owner';
const OTHER_UID = 'push-device-other';
const DEVICE_ID = 'a'.repeat(64);
const TOKEN_OWNER_ID = 'c'.repeat(64);

let testEnv: RulesTestEnvironment;

function deviceRef(db: Firestore, uid = OWNER_UID) {
  return doc(db, 'users', uid, 'push_devices', DEVICE_ID);
}

function tokenOwnerRef(db: Firestore) {
  return doc(db, 'push_token_owners', TOKEN_OWNER_ID);
}

describe('Firestore Rules / push devices', () => {
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

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(deviceRef(context.firestore()), {
        token: 'server-owned-token',
        platform: 'web',
        schemaVersion: 1,
      });
      await setDoc(tokenOwnerRef(context.firestore()), {
        uid: OWNER_UID,
        deviceId: DEVICE_ID,
        schemaVersion: 1,
      });
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('nega leitura do próprio token e listagem da coleção privada', async () => {
    const db = testEnv.authenticatedContext(OWNER_UID).firestore();

    await assertFails(getDoc(deviceRef(db)));
    await assertFails(
      getDocs(collection(db, 'users', OWNER_UID, 'push_devices'))
    );
  });

  it('nega leitura de tokens de outro usuário', async () => {
    const db = testEnv.authenticatedContext(OTHER_UID).firestore();

    await assertFails(getDoc(deviceRef(db)));
  });

  it('nega criação, alteração e exclusão direta mesmo para o proprietário', async () => {
    const db = testEnv.authenticatedContext(OWNER_UID).firestore();
    const existingRef = deviceRef(db);
    const forgedRef = doc(
      db,
      'users',
      OWNER_UID,
      'push_devices',
      'b'.repeat(64)
    );

    await assertFails(
      setDoc(forgedRef, {
        token: 'forged-token-that-must-never-be-accepted-directly',
        platform: 'web',
      })
    );
    await assertFails(updateDoc(existingRef, { platform: 'android' }));
    await assertFails(deleteDoc(existingRef));
  });

  it('nega acesso direto ao ownership global do token', async () => {
    const ownerDb = testEnv.authenticatedContext(OWNER_UID).firestore();
    const otherDb = testEnv.authenticatedContext(OTHER_UID).firestore();
    const currentOwnerRef = tokenOwnerRef(ownerDb);
    const forgedOwnerRef = doc(
      ownerDb,
      'push_token_owners',
      'b'.repeat(64)
    );

    await assertFails(getDoc(currentOwnerRef));
    await assertFails(getDocs(collection(ownerDb, 'push_token_owners')));
    await assertFails(
      setDoc(forgedOwnerRef, {
        uid: OWNER_UID,
        deviceId: DEVICE_ID,
        schemaVersion: 1,
      })
    );
    await assertFails(updateDoc(currentOwnerRef, { uid: OTHER_UID }));
    await assertFails(deleteDoc(currentOwnerRef));
    await assertFails(getDoc(tokenOwnerRef(otherDb)));
  });

  it('nega acesso não autenticado', async () => {
    const db = testEnv.unauthenticatedContext().firestore();

    await assertFails(getDoc(deviceRef(db)));
    await assertFails(getDoc(tokenOwnerRef(db)));
  });
});
