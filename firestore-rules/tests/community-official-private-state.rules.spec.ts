import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDoc,
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

const PROJECT_ID = 'demo-community-official-private-rules';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8180;
const VIEWER_UID = 'official-viewer';

const PRIVATE_COLLECTIONS = [
  'community_official_associations',
  'community_official_association_audit',
  'community_official_claims',
  'community_official_claim_requests',
  'community_official_claim_audit',
] as const;

let testEnv: RulesTestEnvironment;

function recordRef(db: Firestore, collectionName: string) {
  return doc(db, collectionName, 'record-1');
}

describe('Firestore Rules / community official private state', () => {
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
      for (const collectionName of PRIVATE_COLLECTIONS) {
        await setDoc(recordRef(context.firestore(), collectionName), {
          associationKey: 'organization:organization-1',
          status: 'verified',
          privateEvidence: 'server-only',
        });
      }
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('nega leitura autenticada e anônima de claims, associações e auditorias', async () => {
    const authenticatedDb = testEnv
      .authenticatedContext(VIEWER_UID)
      .firestore();
    const anonymousDb = testEnv.unauthenticatedContext().firestore();

    for (const collectionName of PRIVATE_COLLECTIONS) {
      await assertFails(getDoc(recordRef(authenticatedDb, collectionName)));
      await assertFails(getDoc(recordRef(anonymousDb, collectionName)));
    }
  });

  it('nega criação, alteração e exclusão direta pelo cliente autenticado', async () => {
    const db = testEnv.authenticatedContext(VIEWER_UID).firestore();

    for (const collectionName of PRIVATE_COLLECTIONS) {
      await assertFails(setDoc(doc(db, collectionName, 'forged-record'), {
        status: 'verified',
      }));
      await assertFails(updateDoc(recordRef(db, collectionName), {
        status: 'verified',
      }));
      await assertFails(deleteDoc(recordRef(db, collectionName)));
    }
  });
});
