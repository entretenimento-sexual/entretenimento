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
  expect,
  it,
} from 'vitest';

const PROJECT_ID = 'demo-entretenimento-rules';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8180;
const VIEWER_UID = 'status-age-viewer';
const OWNER_UID = 'status-age-owner';

let testEnv: RulesTestEnvironment;

async function seedViewerAndStatuses(): Promise<void> {
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
      setDoc(doc(db, 'age_eligibility_records', OWNER_UID), {
        uid: OWNER_UID,
        status: 'VERIFIED_ADULT',
        policyVersion: 1,
        source: 'AGE_REVERIFICATION',
        method: 'MANUAL_REVIEW',
        verifiedAt: new Date(Date.now() - 1_000),
        expiresAt: null,
      }),
      setDoc(doc(db, 'user_intent_statuses', `current_${OWNER_UID}`), {
        uid: OWNER_UID,
        ageEligibilityVerifiedAdult: true,
        ageEligibilityValidUntil: new Date(Date.now() + 60_000),
        visibility: 'public_discovery',
        moderation: { state: 'active' },
        expiresAt: Date.now() + 60_000,
      }),
      setDoc(doc(db, 'user_intent_statuses', 'current_hidden_age_owner'), {
        uid: 'hidden_age_owner',
        ageEligibilityVerifiedAdult: false,
        ageEligibilityValidUntil: new Date(Date.now() - 60_000),
        visibility: 'public_discovery',
        moderation: { state: 'active' },
        expiresAt: Date.now() + 60_000,
      }),
    ]);
  });
}

async function setOwnerCanonicalAgeExpiry(expiresAt: Date | null) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), 'age_eligibility_records', OWNER_UID),
      {
        uid: OWNER_UID,
        status: 'VERIFIED_ADULT',
        policyVersion: 1,
        source: 'AGE_REVERIFICATION',
        method: 'MANUAL_REVIEW',
        verifiedAt: new Date(Date.now() - 10_000),
        expiresAt,
      }
    );
  });
}

describe('Firestore Rules / user intent status age visibility', () => {
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
    await seedViewerAndStatuses();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('permite ler status público somente quando a projeção etária do autor está ativa', async () => {
    const db = testEnv.authenticatedContext(VIEWER_UID).firestore();

    await assertSucceeds(
      getDoc(doc(db, 'user_intent_statuses', `current_${OWNER_UID}`))
    );
    await assertFails(
      getDoc(doc(db, 'user_intent_statuses', 'current_hidden_age_owner'))
    );
  });

  it('bloqueia leitura pública direta quando a autoridade do autor expira', async () => {
    await setOwnerCanonicalAgeExpiry(new Date(Date.now() - 1_000));
    const db = testEnv.authenticatedContext(VIEWER_UID).firestore();

    await assertFails(
      getDoc(doc(db, 'user_intent_statuses', `current_${OWNER_UID}`))
    );
  });

  it('exige o filtro etário na consulta pública de Status de Hoje', async () => {
    const db = testEnv.authenticatedContext(VIEWER_UID).firestore();

    const guardedQuery = query(
      collection(db, 'user_intent_statuses'),
      where('ageEligibilityVerifiedAdult', '==', true),
      where('moderation.state', '==', 'active'),
      where('visibility', '==', 'public_discovery')
    );

    const result = await assertSucceeds(getDocs(guardedQuery));
    expect(result.size).toBe(1);

    const unguardedQuery = query(
      collection(db, 'user_intent_statuses'),
      where('moderation.state', '==', 'active'),
      where('visibility', '==', 'public_discovery')
    );

    await assertFails(getDocs(unguardedQuery));
  });

  it('mantém a leitura do próprio current_ disponível para reduzir exposição', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'user_intent_statuses', `current_${VIEWER_UID}`),
        {
          uid: VIEWER_UID,
          ageEligibilityVerifiedAdult: false,
        ageEligibilityValidUntil: new Date(Date.now() - 60_000),
          visibility: 'hidden',
          moderation: { state: 'hidden' },
          expiresAt: Date.now() + 60_000,
        }
      );
    });

    const db = testEnv.authenticatedContext(VIEWER_UID).firestore();

    await assertSucceeds(
      getDoc(doc(db, 'user_intent_statuses', `current_${VIEWER_UID}`))
    );
  });
});
