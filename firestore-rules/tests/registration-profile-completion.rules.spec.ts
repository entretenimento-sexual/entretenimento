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
const IDENTITY_CATALOG_VERSION = 1;

let testEnv: RulesTestEnvironment;

function authenticatedDb(emailVerified: boolean) {
  return testEnv
    .authenticatedContext(UID, { email_verified: emailVerified })
    .firestore();
}

function authenticatedDbWithoutEmailClaim() {
  return testEnv.authenticatedContext(UID, {}).firestore();
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
      registrationCompletedAt: null,
      acceptedTerms: {
        accepted: true,
        version: 'v3',
        acknowledgedPrivacyNotice: true,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      nicknameHistory: [],
    });
    await setDoc(doc(context.firestore(), 'age_eligibility_records', UID), {
      uid: UID,
      status: 'VERIFIED_ADULT',
      policyVersion: 1,
      source: 'AGE_REVERIFICATION',
      method: 'MANUAL_REVIEW',
      verifiedAt: new Date(Date.now() - 1_000),
      expiresAt: null,
    });
  });
}

function publicProfilePayload(): Record<string, unknown> {
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

  it('permite o bootstrap privado sem a claim email_verified inicial', async () => {
    const db = authenticatedDbWithoutEmailClaim();

    await assertSucceeds(
      setDoc(
        doc(db, 'users', UID),
        privateRegistrationSeed(),
        { merge: true }
      )
    );
  });

  it.each([true, false])(
    'nega criação v3 com marcador de consentimento legado igual a %s',
    async (legacyValue) => {
      const db = authenticatedDb(false);
      await assertFails(setDoc(doc(db, 'users', UID), {
        ...privateRegistrationSeed(),
        initialAdultConsentRequired: legacyValue,
      }));
    }
  );

  it('nega reservar nickname público antes do onboarding adulto completo', async () => {
    const db = authenticatedDbWithoutEmailClaim();

    await assertSucceeds(
      setDoc(
        doc(db, 'users', UID),
        privateRegistrationSeed(),
        { merge: true }
      )
    );

    await assertFails(
      setDoc(doc(db, 'public_index', 'nickname:pessoa_segura'), {
        uid: UID,
        type: 'nickname',
        value: 'pessoa_segura',
        createdAt: serverTimestamp(),
        lastChangedAt: serverTimestamp(),
      })
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

  it('impede renomear nickname ou histórico após o cadastro sem bloquear descrição', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID), {
        ...privateRegistrationSeed(), profileCompleted: true,
        publicVisibility: 'visible', interactionBlocked: false,
      });
    });
    const db = authenticatedDb(true);
    await assertFails(updateDoc(doc(db, 'users', UID), { nickname: 'Outro Apelido' }));
    await assertFails(updateDoc(doc(db, 'users', UID), {
      nicknameHistory: [{ nickname: 'outro', date: new Date() }],
    }));
    await assertFails(updateDoc(doc(db, 'users', UID), { nicknameNormalized: 'outro' }));
    await assertSucceeds(updateDoc(doc(db, 'users', UID), {
      nickname: 'Pessoa Segura', descricao: 'Texto editável',
    }));
  });

  it('bloqueia a mudança direta de identidade após o cadastro sem impedir descrição', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID), {
        ...privateRegistrationSeed(),
        profileCompleted: true,
        publicVisibility: 'visible',
        interactionBlocked: false,
        gender: 'mulher',
        declaredIdentityCode: 'mulher',
        identityCatalogVersion: IDENTITY_CATALOG_VERSION,
      });
    });
    const db = authenticatedDb(true);
    await assertFails(updateDoc(doc(db, 'users', UID), {
      gender: 'homem', declaredIdentityCode: 'homem',
      identityCatalogVersion: IDENTITY_CATALOG_VERSION,
    }));
    await assertFails(updateDoc(doc(db, 'users', UID), { gender: 'homem' }));
    await assertFails(updateDoc(doc(db, 'users', UID), {
      identityCatalogVersion: IDENTITY_CATALOG_VERSION + 1,
    }));
    await assertSucceeds(updateDoc(doc(db, 'users', UID), {
      descricao: 'Nova apresentação.',
    }));
  });

  it('não permite substituir nickname já escolhido durante a conclusão', async () => {
    await seedReadyPrivateUser();
    const db = authenticatedDb(true);
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', UID), {
      nickname: 'Outro Apelido', gender: 'mulher',
      declaredIdentityCode: 'mulher', identityCatalogVersion: IDENTITY_CATALOG_VERSION,
      orientation: 'bissexual', estado: 'RJ', municipio: 'Rio de Janeiro',
      profileCompleted: true, publicVisibility: 'visible',
      interactionBlocked: false, registrationCompletedAt: serverTimestamp(),
      updatedAt: serverTimestamp(), updatedAtMs: Date.now(),
    });
    batch.set(doc(db, 'public_profiles', UID), {
      ...publicProfilePayload(), nickname: 'Outro Apelido',
    });
    await assertFails(batch.commit());
  });

  it('permite a conclusão atômica elegível e a criação da projeção pública', async () => {
    await seedReadyPrivateUser();
    const db = authenticatedDb(true);
    const batch = writeBatch(db);

    batch.update(doc(db, 'users', UID), {
      nickname: 'Pessoa Segura',
      gender: 'mulher',
      declaredIdentityCode: 'mulher',
      identityCatalogVersion: IDENTITY_CATALOG_VERSION,
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

  it('conclui cadastro de conta histórica com consentimento v1 não aceito, mas admissão 18+ válida', async () => {
    await seedReadyPrivateUser();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'users', UID), {
        initialAdultConsentRequired: true,
        adultConsent: { accepted: false, version: 'v1' },
      });
    });

    const db = authenticatedDb(true);
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', UID), {
      nickname: 'Pessoa Segura', gender: 'mulher',
      declaredIdentityCode: 'mulher',
      identityCatalogVersion: IDENTITY_CATALOG_VERSION,
      orientation: 'bissexual', estado: 'RJ', municipio: 'Rio de Janeiro',
      profileCompleted: true, publicVisibility: 'visible',
      interactionBlocked: false, registrationCompletedAt: serverTimestamp(),
      updatedAt: serverTimestamp(), updatedAtMs: Date.now(),
    });
    batch.set(doc(db, 'public_profiles', UID), publicProfilePayload());
    await assertSucceeds(batch.commit());
  });

  it('admite autodeclaração 18+ canônica no cadastro sem exigir VERIFIED_ADULT', async () => {
    await seedReadyPrivateUser();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'age_eligibility_records', UID), {
        uid: UID, status: 'SELF_DECLARED_ADULT', policyVersion: 1,
        source: 'SELF_DECLARATION', method: 'SELF_DECLARATION',
        decidedAt: new Date(Date.now() - 1_000), verifiedAt: null, expiresAt: null,
      });
    });
    const db = authenticatedDb(true);
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', UID), {
      nickname: 'Pessoa Segura', gender: 'mulher',
      declaredIdentityCode: 'mulher',
      identityCatalogVersion: IDENTITY_CATALOG_VERSION,
      orientation: 'bissexual', estado: 'RJ', municipio: 'Rio de Janeiro',
      profileCompleted: true, publicVisibility: 'visible',
      interactionBlocked: false, registrationCompletedAt: serverTimestamp(),
      updatedAt: serverTimestamp(), updatedAtMs: Date.now(),
    });
    batch.set(doc(db, 'public_profiles', UID), publicProfilePayload());
    await assertSucceeds(batch.commit());
  });

  it.each([
    {
      name: 'menoridade confirmada',
      status: 'DENIED_UNDERAGE',
      source: 'AGE_REVERIFICATION', method: 'MANUAL_REVIEW',
      decidedAt: new Date(Date.now() - 1_000),
    },
    {
      name: 'revisão pendente',
      status: 'REVIEW_REQUIRED',
      source: 'INITIAL_VERIFICATION', method: 'MANUAL_REVIEW',
      decidedAt: new Date(Date.now() - 1_000),
    },
    {
      name: 'declaração sem timestamp',
      status: 'SELF_DECLARED_ADULT',
      source: 'SELF_DECLARATION', method: 'SELF_DECLARATION',
      decidedAt: null,
    },
    {
      name: 'declaração com fonte adulterada',
      status: 'SELF_DECLARED_ADULT',
      source: 'MIGRATION', method: 'MIGRATED_REVIEW',
      decidedAt: new Date(Date.now() - 1_000),
    },
  ])('não libera registro com $name', async (eligibility) => {
    await seedReadyPrivateUser();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'age_eligibility_records', UID), {
        uid: UID, policyVersion: 1, verifiedAt: null, expiresAt: null,
        ...eligibility,
      });
    });
    const db = authenticatedDb(true);
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', UID), {
      nickname: 'Pessoa Segura', gender: 'mulher',
      declaredIdentityCode: 'mulher',
      identityCatalogVersion: IDENTITY_CATALOG_VERSION,
      orientation: 'bissexual', estado: 'RJ', municipio: 'Rio de Janeiro',
      profileCompleted: true, publicVisibility: 'visible',
      interactionBlocked: false, registrationCompletedAt: serverTimestamp(),
      updatedAt: serverTimestamp(), updatedAtMs: Date.now(),
    });
    batch.set(doc(db, 'public_profiles', UID), publicProfilePayload());
    await assertFails(batch.commit());
  });

  it('nega conclusão quando a projeção pública diverge da declaração privada', async () => {
    await seedReadyPrivateUser();
    const db = authenticatedDb(true);
    const batch = writeBatch(db);

    batch.update(doc(db, 'users', UID), {
      nickname: 'Pessoa Segura',
      gender: 'mulher',
      declaredIdentityCode: 'mulher',
      identityCatalogVersion: IDENTITY_CATALOG_VERSION,
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
    batch.set(doc(db, 'public_profiles', UID), {
      ...publicProfilePayload(),
      identityCode: 'homem',
    });

    await assertFails(batch.commit());
  });

  it('nega conclusão atômica sem elegibilidade etária canônica', async () => {
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
        initialAdultConsentRequired: false,
        registrationCompletedAt: null,
        acceptedTerms: {
          accepted: true,
          version: 'v3',
          acknowledgedPrivacyNotice: true,
        },
        adultConsent: { accepted: true, version: 'v1' },
      });
    });

    const db = authenticatedDb(true);
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', UID), {
      nickname: 'Pessoa Segura',
      gender: 'mulher',
      declaredIdentityCode: 'mulher',
      identityCatalogVersion: IDENTITY_CATALOG_VERSION,
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
      declaredIdentityCode: 'mulher',
      identityCatalogVersion: IDENTITY_CATALOG_VERSION,
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
