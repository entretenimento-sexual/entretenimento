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
const UID = 'presence-adult-user';

let testEnv: RulesTestEnvironment;

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

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const now = Timestamp.now();

      await setDoc(doc(db, 'users', UID), {
        uid: UID,
        accountStatus: 'active',
        suspended: false,
        interactionBlocked: false,
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

      await setDoc(doc(db, 'age_eligibility_records', UID), {
        uid: UID,
        status: 'DECLARED_ADULT',
        policyVersion: 1,
        source: 'INITIAL_DECLARATION',
        method: 'SELF_DECLARATION',
        verifiedAt: null,
        decidedAt: now,
        expiresAt: null,
      });

      // Deliberadamente sem lastOfflineAt/lastOnlineAt. O update deve aceitar
      // campos opcionais ausentes sem "Null value error" nas Rules.
      await setDoc(doc(db, 'presence', UID), {
        uid: UID,
        presenceSessionId: 'session-1',
        presenceState: 'online',
        isOnline: true,
        lastSeen: now,
        updatedAt: now,
      });
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('aceita heartbeat para autodeclaração adulta backend no modo inicial', async () => {
    const db = testEnv.authenticatedContext(UID).firestore();

    await assertSucceeds(
      updateDoc(doc(db, 'presence', UID), {
        presenceSessionId: 'session-1',
        presenceState: 'online',
        isOnline: true,
        lastSeen: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('nega presença quando a autoridade etária deixa de autorizar acesso adulto', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'age_eligibility_records', UID), {
        uid: UID,
        status: 'REVIEW_REQUIRED',
        policyVersion: 1,
        source: 'INITIAL_VERIFICATION',
        method: 'MANUAL_REVIEW',
        verifiedAt: null,
        expiresAt: null,
      });
    });

    const db = testEnv.authenticatedContext(UID).firestore();

    await assertFails(
      updateDoc(doc(db, 'presence', UID), {
        presenceSessionId: 'session-1',
        presenceState: 'online',
        isOnline: true,
        lastSeen: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });
});
