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

const PROJECT_ID = 'demo-users-photos-display-date-rules';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8180;
const UID = 'photo-date-user';
const PHOTO_ID = 'photo-date-1';

let testEnv: RulesTestEnvironment;

function authenticatedDb() {
  return testEnv.authenticatedContext(UID).firestore();
}

async function seedUser(options: {
  canonicalSubscriber?: boolean;
  legacyAliases?: boolean;
} = {}) {
  const now = Date.now();

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

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
      initialAdultConsentRequired: false,
      adultConsent: { accepted: true, version: 'v1' },
      ageReverification: { status: 'NONE' },
      ...(options.legacyAliases
        ? {
          monthlyPayer: true,
          role: 'premium',
          subscriptionStatus: 'active',
        }
        : {}),
      ...(options.canonicalSubscriber
        ? {
          billingProjectionVersion: 1,
          isSubscriber: true,
          tier: 'basic',
          role: 'basic',
          subscriptionStatus: 'active',
          subscriptionScope: 'platform_subscription',
          subscriptionStartedAt: Timestamp.fromMillis(now - 60_000),
          subscriptionEndsAt: Timestamp.fromMillis(now + 3_600_000),
        }
        : {}),
    });

    await setDoc(doc(db, 'age_eligibility_records', UID), {
      uid: UID,
      status: 'VERIFIED_ADULT',
      policyVersion: 1,
      source: 'AGE_REVERIFICATION',
      method: 'MANUAL_REVIEW',
      verifiedAt: Timestamp.fromMillis(now - 1_000),
      expiresAt: null,
    });
  });
}

function photoPayload(displayDate?: number | null) {
  return {
    id: PHOTO_ID,
    path: `users/${UID}/uploads/images/${PHOTO_ID}.png`,
    fileName: 'foto.png',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...(displayDate === undefined ? {} : { displayDate }),
  };
}

describe('Firestore Rules / users photos displayDate', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        host: FIRESTORE_HOST,
        port: FIRESTORE_PORT,
        rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
      },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  afterAll(async () => testEnv.cleanup());

  it('permite displayDate ao próprio usuário sem depender de assinatura', async () => {
    await seedUser();
    const ref = doc(authenticatedDb(), 'users', UID, 'photos', PHOTO_ID);

    await assertSucceeds(setDoc(ref, photoPayload(Date.now())));
    await assertSucceeds(updateDoc(ref, {
      displayDate: Date.now() - 86_400_000,
      updatedAt: Timestamp.now(),
    }));
  });

  it('mantém displayDate independente de aliases ou projeções comerciais', async () => {
    await seedUser({ canonicalSubscriber: true, legacyAliases: true });
    const ref = doc(authenticatedDb(), 'users', UID, 'photos', PHOTO_ID);

    await assertSucceeds(setDoc(ref, photoPayload(Date.now())));
    await assertSucceeds(updateDoc(ref, {
      displayDate: null,
      updatedAt: Timestamp.now(),
    }));
  });

  it('continua rejeitando displayDate inválido por contrato de dados', async () => {
    await seedUser();
    const ref = doc(authenticatedDb(), 'users', UID, 'photos', PHOTO_ID);

    await assertFails(setDoc(ref, {
      ...photoPayload(),
      displayDate: '2026-09-26',
    }));
  });
});
