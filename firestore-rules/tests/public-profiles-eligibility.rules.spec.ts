// firestore-rules/tests/public-profiles-eligibility.rules.spec.ts
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
const UID = 'public-profile-user';

let testEnv: RulesTestEnvironment;

function privateUser(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    uid: UID,
    accountStatus: 'active',
    emailVerified: true,
    profileCompleted: true,
    publicVisibility: 'visible',
    interactionBlocked: false,
    loginAllowed: true,
    acceptedTerms: { accepted: true },
    initialAdultConsentRequired: true,
    adultConsent: { accepted: true, version: 'v1' },
    ...overrides,
  };
}

function publicProfile(): Record<string, unknown> {
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

function authenticatedDb() {
  return testEnv
    .authenticatedContext(UID, { email_verified: true })
    .firestore();
}

async function seedUser(
  overrides: Record<string, unknown> = {}
): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), 'users', UID),
      privateUser(overrides)
    );
  });
}

async function seedPublicProfile(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), 'public_profiles', UID),
      {
        ...publicProfile(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    );
  });
}

describe('Firestore Rules / public profile eligibility', () => {
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

  it('permite criar a projeção para conta plenamente elegível', async () => {
    await seedUser();
    const db = authenticatedDb();

    await assertSucceeds(
      setDoc(doc(db, 'public_profiles', UID), publicProfile())
    );
  });

  it('nega projeção antes da verificação do e-mail', async () => {
    await seedUser({ emailVerified: false });
    const db = authenticatedDb();

    await assertFails(
      setDoc(doc(db, 'public_profiles', UID), publicProfile())
    );
  });

  it('nega projeção antes do aceite auditável dos termos', async () => {
    await seedUser({ acceptedTerms: { accepted: false } });
    const db = authenticatedDb();

    await assertFails(
      setDoc(doc(db, 'public_profiles', UID), publicProfile())
    );
  });

  it('nega projeção antes do consentimento adulto obrigatório', async () => {
    await seedUser({ adultConsent: { accepted: false } });
    const db = authenticatedDb();

    await assertFails(
      setDoc(doc(db, 'public_profiles', UID), publicProfile())
    );
  });

  it('nega projeção para perfil incompleto', async () => {
    await seedUser({ profileCompleted: false });
    const db = authenticatedDb();

    await assertFails(
      setDoc(doc(db, 'public_profiles', UID), publicProfile())
    );
  });

  it('nega projeção para conta suspensa ou bloqueada', async () => {
    await seedUser({
      accountStatus: 'moderation_suspended',
      publicVisibility: 'hidden',
      interactionBlocked: true,
    });
    const db = authenticatedDb();

    await assertFails(
      setDoc(doc(db, 'public_profiles', UID), publicProfile())
    );
  });

  it('nega atualizar perfil público depois que a conta deixa de ser elegível', async () => {
    await seedUser({
      accountStatus: 'self_suspended',
      publicVisibility: 'hidden',
      interactionBlocked: true,
    });
    await seedPublicProfile();
    const db = authenticatedDb();

    await assertFails(
      updateDoc(doc(db, 'public_profiles', UID), {
        avatarUrl: 'https://example.com/avatar.webp',
        updatedAt: serverTimestamp(),
      })
    );
  });
});
