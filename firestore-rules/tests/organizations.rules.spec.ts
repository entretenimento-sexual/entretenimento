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

const PROJECT_ID = 'demo-organization-rules';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8180;
const VIEWER_UID = 'organization-viewer';

let testEnv: RulesTestEnvironment;

function organizationRef(db: Firestore) {
  return doc(db, 'organizations', 'organization-1');
}

const PRIVATE_COLLECTIONS = [
  'organizations',
  'organization_kyb_records',
  'organization_kyb_audit',
  'organization_representations',
  'organization_representation_audit',
] as const;

describe('Firestore Rules / organization canonical compliance records', () => {
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
      await setDoc(organizationRef(context.firestore()), {
        organizationId: 'organization-1',
        displayName: 'Organização Um',
        status: 'active',
        countryCode: 'BR',
      });
      for (const collectionName of PRIVATE_COLLECTIONS.slice(1)) {
        await setDoc(doc(context.firestore(), collectionName, 'record-1'), {
          organizationId: 'organization-1',
          privateEvidence: 'server-only',
        });
      }
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('nega leitura autenticada e anônima da Organização canônica', async () => {
    await assertFails(
      getDoc(organizationRef(testEnv.authenticatedContext(VIEWER_UID).firestore()))
    );
    await assertFails(
      getDoc(organizationRef(testEnv.unauthenticatedContext().firestore()))
    );
  });

  it('nega leitura de KYB, representação e auditorias mesmo autenticado', async () => {
    const db = testEnv.authenticatedContext(VIEWER_UID).firestore();
    for (const collectionName of PRIVATE_COLLECTIONS.slice(1)) {
      await assertFails(getDoc(doc(db, collectionName, 'record-1')));
    }
  });

  it('nega criação, alteração e exclusão direta pelo cliente', async () => {
    const db = testEnv.authenticatedContext(VIEWER_UID).firestore();
    for (const collectionName of PRIVATE_COLLECTIONS) {
      const target = doc(db, collectionName, 'record-1');
      await assertFails(setDoc(doc(db, collectionName, 'forged-record'), {
        status: 'verified',
      }));
      await assertFails(updateDoc(target, { status: 'verified' }));
      await assertFails(deleteDoc(target));
    }
  });
});
