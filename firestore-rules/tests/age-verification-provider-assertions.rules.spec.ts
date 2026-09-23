import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
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
const UID = 'provider-assertion-user';
const ASSERTION_ID = 'assertion-1';

let testEnv: RulesTestEnvironment;

describe('Firestore Rules / age provider assertions', () => {
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
      await setDoc(
        doc(
          context.firestore(),
          'age_verification_provider_assertions',
          ASSERTION_ID
        ),
        {
          uid: UID,
          provider: 'trusted-provider',
          result: 'VERIFIED_ADULT',
          assuranceLevel: 'HIGH',
          verifiedAtMs: Date.now(),
          expiresAtMs: null,
          providerReferenceHash: 'a'.repeat(64),
        }
      );
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('nega leitura da assertion ao titular', async () => {
    const db = testEnv.authenticatedContext(UID).firestore();

    await assertFails(
      getDoc(
        doc(db, 'age_verification_provider_assertions', ASSERTION_ID)
      )
    );
  });

  it('nega escrita de assertion pelo titular', async () => {
    const db = testEnv.authenticatedContext(UID).firestore();

    await assertFails(
      setDoc(
        doc(db, 'age_verification_provider_assertions', 'forged'),
        {
          uid: UID,
          provider: 'fake-provider',
          result: 'VERIFIED_ADULT',
          assuranceLevel: 'HIGH',
          verifiedAtMs: Date.now(),
          expiresAtMs: null,
          providerReferenceHash: 'b'.repeat(64),
        }
      )
    );
  });
});
