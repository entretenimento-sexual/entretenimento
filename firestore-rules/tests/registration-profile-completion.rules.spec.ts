// firestore-rules/tests/registration-profile-completion.rules.spec.ts
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
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
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
const UID = 'registration-user';

let testEnv: RulesTestEnvironment;

function authenticatedDb(emailVerified: boolean) {
  return testEnv
    .authenticatedContext(UID, { email_verified: emailVerified })
    .firestore();
}

function privateRegistrationSeed(): Record<string, unknown> {
  return {
    uid: UID,
    email: 'user@example.com',
    nickname: 'Pessoa Segura',
    role: 'free',
    tier: 'free',
    emailVerified: false,
    isSubscriber: false,
    subscriptionStatus: 'inactive',
    accountStatus: 'active',
    profileCompleted: false,
    publicVisibility: 'hidden',
    interactionBlocked: true,
    loginAllowed: true,
    registrationFlowVersion: 'v3-private-by-default',
    initialAdultConsentRequired: true,
    registrationCompletedAt: null,
    acceptedTerms: {
      accepted: false,
      date: serverTimestamp(),
    },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    registrationDate: serverTimestamp(),
    firstLogin: serverTimestamp(),
    nicknameHistory: [],
  };
}

async function seedReadyPrivateUser(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', UID), {
      uid: UID,
      email: 'user@example.com',
      nickname: 'Pessoa Segura',
      role: 'free',
      tier: 'free',
      emailVerified: true,
      isSubscriber: false,
      subscriptionStatus: 'inactive',
      accountStatus: 'active',
      profileCompleted: false,
      publicVisibility: 'hidden',
      interactionBlocked: true,
      loginAllowed: true,
      registrationFlowVersion: 'v3-private-by-default',
      initialAdultConsentRequired: true,
      registrationCompletedAt: null,
      acceptedTerms: { accepted: true },
      adultConsent: { accepted: true, version: 'v1' },
      createdAt: new Date(),
      updatedAt: new Date(),
      nicknameHistory: [],
    });
  });
}

function publicProfilePayload(): Record<string, unknown> {
  return {
    uid: UID,
    nickname: 'Pessoa Segura',
    nicknameNormalized: 'pessoa_segura',
    gender: 'mulher',
    orientation: 'bissexual',
    estado: 'RJ',
    municipio: 'Rio de Janeiro',
    role: 'free',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

describe('Firestore Rules / registration and profile completion', () => {
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

  it('permite criar a conta v3 privada e bloqueada para interação', async () => {
    const db = authenticatedDb(false);

    await assertSucceeds(
      setDoc(doc(db, 'users', UID), privateRegistrationSeed())
    );
  });

  it('nega criar a conta v3 já visível ou interativa', async () => {
    const db = authenticatedDb(false);

    await assertFails(
      setDoc(doc(db, 'users', UID), {
        ...privateRegistrationSeed(),
        publicVisibility: 'visible',
        interactionBlocked: false,
      })
    );
  });

  it('nega marcar profileCompleted isoladamente', async () => {
    await seedReadyPrivateUser();
    const db = authenticatedDb(true);

    await assertFails(
      updateDoc(doc(db, 'users', UID), {
        profileCompleted: true,
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('permite a conclusão atômica elegível e a criação da projeção pública', async () => {
    await seedReadyPrivateUser();
    const db = authenticatedDb(true);
    const batch = writeBatch(db);

    batch.update(doc(db, 'users', UID), {
      nickname: 'Pessoa Segura',
      gender: 'mulher',
      orientation: 'bissexual',
      estado: 'RJ',
      municipio: 'Rio de Janeiro',
      profileCompleted: true,
      publicVisibility: 'visible',
      interactionBlocked: false,
      registrationCompletedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedAtMs: Date.now(),
    });
    batch.set(
      doc(db, 'public_profiles', UID),
      publicProfilePayload()
    );

    await assertSucceeds(batch.commit());
  });

  it('nega conclusão atômica sem termos aceitos', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users', UID), {
        uid: UID,
        nickname: 'Pessoa Segura',
        accountStatus: 'active',
        emailVerified: true,
        profileCompleted: false,
        publicVisibility: 'hidden',
        interactionBlocked: true,
        loginAllowed: true,
        registrationFlowVersion: 'v3-private-by-default',
        initialAdultConsentRequired: true,
        registrationCompletedAt: null,
        acceptedTerms: { accepted: false },
        adultConsent: { accepted: true },
      });
    });

    const db = authenticatedDb(true);
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', UID), {
      gender: 'mulher',
      orientation: 'bissexual',
      estado: 'RJ',
      municipio: 'Rio de Janeiro',
      profileCompleted: true,
      publicVisibility: 'visible',
      interactionBlocked: false,
      registrationCompletedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedAtMs: Date.now(),
    });
    batch.set(doc(db, 'public_profiles', UID), publicProfilePayload());

    await assertFails(batch.commit());
  });
});
