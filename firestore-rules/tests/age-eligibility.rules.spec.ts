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
const USER_UID = 'age-eligibility-user';

let testEnv: RulesTestEnvironment;

describe('Firestore Rules / age eligibility records', () => {
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
        doc(context.firestore(), 'age_eligibility_records', USER_UID),
        {
          uid: USER_UID,
          status: 'VERIFIED_ADULT',
          policyVersion: 1,
          source: 'AGE_REVERIFICATION',
          method: 'MANUAL_REVIEW',
          verifiedAtMs: Date.now(),
          expiresAtMs: null,
        }
      );
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('nega leitura do registro canônico ao próprio usuário', async () => {
    const db = testEnv.authenticatedContext(USER_UID).firestore();

    await assertFails(
      getDoc(doc(db, 'age_eligibility_records', USER_UID))
    );
  });

  it('nega escrita do registro canônico ao próprio usuário', async () => {
    const db = testEnv.authenticatedContext(USER_UID).firestore();

    await assertFails(
      setDoc(doc(db, 'age_eligibility_records', USER_UID), {
        uid: USER_UID,
        status: 'VERIFIED_ADULT',
        policyVersion: 999,
      })
    );
  });
});
