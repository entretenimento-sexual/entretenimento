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
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
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
const UID = 'public-profile-user';
const IDENTITY_CATALOG_VERSION = 1;

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
    gender: 'mulher',
    declaredIdentityCode: 'mulher',
    identityCatalogVersion: IDENTITY_CATALOG_VERSION,
    acceptedTerms: {
      accepted: true,
      version: 'v3',
      acknowledgedPrivacyNotice: true,
    },
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
    identityCode: 'mulher',
    identityCatalogVersion: IDENTITY_CATALOG_VERSION,
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
  overrides: Record<string, unknown> = {},
  includeAgeEligibility = true
): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'users', UID), privateUser(overrides));

    if (includeAgeEligibility) {
      await setDoc(doc(db, 'age_eligibility_records', UID), {
        uid: UID,
        status: 'VERIFIED_ADULT',
        policyVersion: 1,
        source: 'AGE_REVERIFICATION',
        method: 'MANUAL_REVIEW',
        verifiedAt: new Date(Date.now() - 1_000),
        expiresAt: null,
      });
    }
  });
}

async function seedPublicProfile(
  overrides: Record<string, unknown> = {}
): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), 'public_profiles', UID),
      {
        ...publicProfile(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
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

  it('nega projeção pública que diverge da identidade declarada', async () => {
    await seedUser();
    const db = authenticatedDb();

    await assertFails(
      setDoc(doc(db, 'public_profiles', UID), {
        ...publicProfile(),
        gender: 'homem',
        identityCode: 'homem',
      })
    );
  });

  it('nega projeção sem verificação etária canônica', async () => {
    await seedUser({}, false);
    const db = authenticatedDb();

    await assertFails(
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

  it('nega projeção com versão anterior ou sem ciência de privacidade', async () => {
    const db = authenticatedDb();

    await seedUser({
      acceptedTerms: {
        accepted: true,
        version: 'v2',
        acknowledgedPrivacyNotice: true,
      },
    });
    await assertFails(
      setDoc(doc(db, 'public_profiles', UID), publicProfile())
    );

    await seedUser({
      acceptedTerms: {
        accepted: true,
        version: 'v3',
        acknowledgedPrivacyNotice: false,
      },
    });
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

  it('nega ao cliente criar campos calculados pelo backend', async () => {
    await seedUser();
    const db = authenticatedDb();

    await assertFails(
      setDoc(doc(db, 'public_profiles', UID), {
        ...publicProfile(),
        age: 31,
        ageEligibilityVerifiedAdult: true,
        ageEligibilityValidUntil: new Date(Date.now() + 60_000),
        publicRelationshipIntents: ['dating'],
        publicSexualPractices: ['bdsm'],
        publicBodyTraits: ['tattoos'],
        preferenceBadgesVisible: true,
      })
    );
  });

  it('nega ao cliente alterar sinais públicos calculados pelo backend', async () => {
    await seedUser();
    await seedPublicProfile({
      age: 31,
      publicRelationshipIntents: ['dating'],
      publicSexualPractices: ['bdsm'],
      publicBodyTraits: ['tattoos'],
      preferenceBadgesVisible: true,
    });
    const db = authenticatedDb();

    await assertFails(
      updateDoc(doc(db, 'public_profiles', UID), {
        age: 32,
        publicBodyTraits: ['athletic'],
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('permite ler perfil-alvo somente com projeção etária backend-only ativa e vigente', async () => {
    await seedUser();
    await seedPublicProfile({
      ageEligibilityVerifiedAdult: true,
      ageEligibilityValidUntil: new Date(Date.now() + 60_000),
    });
    const db = authenticatedDb();

    await assertSucceeds(getDoc(doc(db, 'public_profiles', UID)));

    await seedPublicProfile({
      ageEligibilityVerifiedAdult: true,
      ageEligibilityValidUntil: new Date(Date.now() - 1_000),
    });

    await assertFails(getDoc(doc(db, 'public_profiles', UID)));

    await seedPublicProfile({
      ageEligibilityVerifiedAdult: false,
      ageEligibilityValidUntil: new Date(Date.now() + 60_000),
    });

    await assertFails(getDoc(doc(db, 'public_profiles', UID)));
  });

  it('nega qualquer enumeração client-side de public_profiles', async () => {
    await seedUser();
    await seedPublicProfile({
      ageEligibilityVerifiedAdult: true,
      ageEligibilityValidUntil: new Date(Date.now() + 60_000),
    });
    const db = authenticatedDb();

    const guardedQuery = query(
      collection(db, 'public_profiles'),
      where('ageEligibilityVerifiedAdult', '==', true)
    );

    await assertFails(getDocs(guardedQuery));
    await assertFails(getDocs(collection(db, 'public_profiles')));

    // Deep link documental continua disponível sob a fronteira temporal forte.
    await assertSucceeds(getDoc(doc(db, 'public_profiles', UID)));
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
