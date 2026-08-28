// firestore-rules/tests/community-backend-state.rules.spec.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, describe, it } from 'vitest';

const PROJECT_ID = 'demo-entretenimento-rules';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8180;
const USER_UID = 'community-backend-state-user';

let testEnv: RulesTestEnvironment;

const PRIVATE_DOCUMENT_PATHS = [
  ['community_lifecycle_runtime', 'daily'],
  ['community_lifecycle_audit', 'audit-1'],
] as const;

const PRIVATE_COLLECTIONS = [
  'community_lifecycle_runtime',
  'community_lifecycle_audit',
] as const;

describe('Firestore Rules / Community backend state', () => {
  beforeAll(async () => {
    const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');

    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        host: FIRESTORE_HOST,
        port: FIRESTORE_PORT,
        rules,
      },
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('nega leitura individual do estado operacional do lifecycle ao cliente', async () => {
    const db = testEnv.authenticatedContext(USER_UID).firestore();

    for (const [collectionName, documentId] of PRIVATE_DOCUMENT_PATHS) {
      await assertFails(getDoc(doc(db, collectionName, documentId)));
    }
  });

  it('nega enumeração das coleções operacionais do lifecycle', async () => {
    const db = testEnv.authenticatedContext(USER_UID).firestore();

    for (const collectionName of PRIVATE_COLLECTIONS) {
      await assertFails(getDocs(collection(db, collectionName)));
    }
  });

  it('nega escrita direta no estado operacional do lifecycle', async () => {
    const db = testEnv.authenticatedContext(USER_UID).firestore();

    await assertFails(
      setDoc(doc(db, 'community_lifecycle_runtime', 'daily'), {
        cursor: null,
      })
    );
    await assertFails(
      setDoc(doc(db, 'community_lifecycle_audit', 'audit-1'), {
        action: 'forged',
      })
    );
  });
});
