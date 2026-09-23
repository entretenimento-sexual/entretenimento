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

async function seedAdultSocialAccess(
  verifiedAdult = true
): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const now = Date.now();

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
    });

    if (verifiedAdult) {
      await setDoc(doc(db, 'age_eligibility_records', USER_UID), {
        uid: USER_UID,
        status: 'VERIFIED_ADULT',
        policyVersion: 1,
        verifiedAt: Timestamp.fromMillis(now - 60_000),
        expiresAt: Timestamp.fromMillis(now + 60 * 60_000),
      });
    }

    await setDoc(doc(db, 'presence', USER_UID), {
      uid: USER_UID,
      presenceSessionId: 'tab-seed',
      isOnline: false,
      presenceState: 'offline',
      lastSeen: Timestamp.fromMillis(now - 1_000),
      updatedAt: Timestamp.fromMillis(now - 1_000),
    });
  });
}

describe('Firestore Rules / presence adult social boundary', () => {
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

  it('permite heartbeat adulto mesmo sem timestamps opcionais ausentes', async () => {
    await seedAdultSocialAccess(true);
    const db = authenticatedDb();

    await assertSucceeds(
      updateDoc(doc(db, 'presence', USER_UID), {
        presenceSessionId: 'tab-live',
        isOnline: true,
        presenceState: 'online',
        lastSeen: Timestamp.now(),
        updatedAt: Timestamp.now(),
      })
    );
  });

  it('nega heartbeat enquanto a elegibilidade adulta não foi confirmada', async () => {
    await seedAdultSocialAccess(false);
    const db = authenticatedDb();

    await assertFails(
      updateDoc(doc(db, 'presence', USER_UID), {
        presenceSessionId: 'tab-live',
        isOnline: true,
        presenceState: 'online',
        lastSeen: Timestamp.now(),
        updatedAt: Timestamp.now(),
      })
    );
  });
});
