import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
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
const USER_UID = 'compliance-user';

let testEnv: RulesTestEnvironment;

function authenticatedDb() {
  return testEnv.authenticatedContext(USER_UID, {
    email_verified: true,
  }).firestore();
}

function validUserSeed(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    uid: USER_UID,
    email: 'compliance@example.test',
    role: 'free',
    tier: 'free',
    emailVerified: true,
    isSubscriber: false,
    subscriptionStatus: 'inactive',
    accountStatus: 'active',
    profileCompleted: false,
    registrationFlowVersion: 'v2',
    initialAdultConsentRequired: true,
    registrationCompletedAt: null,
    acceptedTerms: {
      accepted: false,
      date: null,
    },
    roles: ['user'],
    permissions: [],
    entitlements: [],
    suspended: false,
    accountLocked: false,
    publicVisibility: 'visible',
    interactionBlocked: false,
    loginAllowed: true,
    ...overrides,
  };
}

async function seedUserAsAdmin(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), 'users', USER_UID),
      validUserSeed()
    );
  });
}

describe('Firestore Rules / users compliance', () => {
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

  it('permite criar conta nova somente com marcador versionado', async () => {
    const db = authenticatedDb();

    await assertSucceeds(
      setDoc(doc(db, 'users', USER_UID), validUserSeed())
    );
  });

  it('nega criação sem confirmação inicial marcada como obrigatória', async () => {
    const db = authenticatedDb();
    const invalid = validUserSeed();
    delete invalid['initialAdultConsentRequired'];

    await assertFails(setDoc(doc(db, 'users', USER_UID), invalid));
  });

  it('nega criação com estado de revalidação controlado pelo cliente', async () => {
    const db = authenticatedDb();

    await assertFails(
      setDoc(
        doc(db, 'users', USER_UID),
        validUserSeed({
          ageReverification: {
            status: 'VERIFIED',
          },
        })
      )
    );
  });

  it('nega alteração cliente-side do marcador e da revalidação', async () => {
    await seedUserAsAdmin();
    const db = authenticatedDb();

    await assertFails(
      updateDoc(doc(db, 'users', USER_UID), {
        initialAdultConsentRequired: false,
      })
    );

    await assertFails(
      updateDoc(doc(db, 'users', USER_UID), {
        ageReverification: {
          status: 'VERIFIED',
        },
      })
    );
  });

  it('preserva atualização de campo comum do próprio perfil', async () => {
    await seedUserAsAdmin();
    const db = authenticatedDb();

    await assertSucceeds(
      updateDoc(doc(db, 'users', USER_UID), {
        descricao: 'Descrição atualizada pelo usuário.',
      })
    );
  });
});
