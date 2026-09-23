import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
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
const USER_UID = 'presence-adult-user';

let testEnv: RulesTestEnvironment;

function authenticatedDb() {
  return testEnv.authenticatedContext(USER_UID, {
    email_verified: true,
  }).firestore();
}

async function seedAdultAccess(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, 'users', USER_UID), {
      uid: USER_UID,
      accountStatus: 'active',
      suspended: false,
      interactionBlocked: false,
      accountLocked: false,
      loginAllowed: true,
      acceptedTerms: {
        accepted: true,
        version: 'v3',
        acknowledgedPrivacyNotice: true,
      },
      adultConsent: {
        accepted: true,
        version: 'v1',
      },
      ageReverification: {
        status: 'NONE',
      },
    });

    await setDoc(doc(db, 'age_eligibility_records', USER_UID), {
      uid: USER_UID,
      status: 'VERIFIED_ADULT',
      policyVersion: 1,
      source: 'AGE_REVERIFICATION',
      method: 'MANUAL_REVIEW',
      verifiedAt: Timestamp.fromMillis(Date.now() - 60_000),
      expiresAt: Timestamp.fromMillis(Date.now() + 60 * 60_000),
    });

    await setDoc(doc(db, 'presence', USER_UID), {
      uid: USER_UID,
      presenceSessionId: 'seed-session',
      presenceState: 'online',
      isOnline: true,
      lastSeen: Timestamp.fromMillis(Date.now() - 5_000),
      updatedAt: Timestamp.fromMillis(Date.now() - 5_000),
      lastStateChangeAt: Timestamp.fromMillis(Date.now() - 5_000),
      lastOnlineAt: Timestamp.fromMillis(Date.now() - 5_000),
    });
  });
}

describe('Firestore Rules / presence adult runtime', () => {
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
    await seedAdultAccess();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('aceita heartbeat quando timestamps opcionais ausentes permanecem ausentes', async () => {
    const db = authenticatedDb();

    await assertSucceeds(
      updateDoc(doc(db, 'presence', USER_UID), {
        presenceSessionId: 'runtime-session',
        presenceState: 'online',
        isOnline: true,
        lastSeen: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('continua negando presença quando a autoridade etária não é adulta', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'age_eligibility_records', USER_UID),
        {
          uid: USER_UID,
          status: 'REVIEW_REQUIRED',
          policyVersion: 1,
          source: 'INITIAL_VERIFICATION',
          method: 'MANUAL_REVIEW',
          verifiedAt: null,
          expiresAt: null,
        }
      );
    });

    const db = authenticatedDb();

    await assertFails(
      updateDoc(doc(db, 'presence', USER_UID), {
        presenceSessionId: 'runtime-session',
        presenceState: 'online',
        isOnline: true,
        lastSeen: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });
});
