import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
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
const VIEWER_UID = 'friend-request-viewer';
const TARGET_UID = 'friend-request-target';

let testEnv: RulesTestEnvironment;

async function seed(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await Promise.all([
      setDoc(doc(db, 'users', VIEWER_UID), {
        uid: VIEWER_UID,
        accountStatus: 'active',
        suspended: false,
        acceptedTerms: {
          accepted: true,
          version: 'v3',
          acknowledgedPrivacyNotice: true,
        },
        initialAdultConsentRequired: false,
        adultConsent: { accepted: true, version: 'v1' },
        ageReverification: { status: 'NONE' },
      }),
      setDoc(doc(db, 'age_eligibility_records', VIEWER_UID), {
        uid: VIEWER_UID,
        status: 'VERIFIED_ADULT',
        policyVersion: 1,
        source: 'AGE_REVERIFICATION',
        method: 'MANUAL_REVIEW',
        verifiedAt: new Date(Date.now() - 1_000),
        expiresAt: null,
      }),
      setDoc(doc(db, 'friendRequests', 'request-1'), {
        requesterUid: TARGET_UID,
        targetUid: VIEWER_UID,
        status: 'pending',
        message: 'Olá',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ]);
  });
}

describe('Firestore Rules / friend request read boundary', () => {
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
    await seed();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('permite get participante e bloqueia qualquer listagem client-side', async () => {
    const db = testEnv.authenticatedContext(VIEWER_UID).firestore();

    await assertSucceeds(
      getDoc(doc(db, 'friendRequests', 'request-1'))
    );

    await assertFails(
      getDocs(
        query(
          collection(db, 'friendRequests'),
          where('targetUid', '==', VIEWER_UID),
          where('status', '==', 'pending')
        )
      )
    );

    await assertFails(getDocs(collection(db, 'friendRequests')));
  });
});
