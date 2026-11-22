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
const VISITOR_UID = 'public-profile-visitor';
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
    nickname: 'Pessoa Segura',
    publicVisibility: 'visible',
    interactionBlocked: false,
    loginAllowed: true,
    gender: 'mulher',
    declaredIdentityCode: 'mulher',
    identityCatalogVersion: IDENTITY_CATALOG_VERSION,
    acceptedTerms: {
      accepted: true,
      version: 'v3',
      termsDocumentVersion: '2026-09-29.1',
      privacyNoticeVersion: '2026-09-29.1',
      acknowledgedPrivacyNotice: true,
    },
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

/** Visitante adulto elegível, separado da conta dona e sem acesso privado. */
async function seedVisitor(
  overrides: Record<string, unknown> = {}
): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await setDoc(
      doc(database, 'users', VISITOR_UID),
      privateUser({ uid: VISITOR_UID, ...overrides })
    );
  });
}

function visitorDb() {
  return testEnv
    .authenticatedContext(VISITOR_UID, { email_verified: true })
    .firestore();
}

async function seedBilateralBlock(
  blockerUid: string,
  targetUid: string,
  isBlocked = true
): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), 'users', blockerUid, 'blocks', targetUid),
      { isBlocked, updatedAt: new Date() }
    );
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

  it.each([undefined, null, false])(
    'nega republicar orientação sem autorização explícita (%s)',
    async (consent) => {
      await seedUser({
        orientation: 'bissexual',
        ...(consent === undefined ? {} : { showOrientationPublicly: consent }),
      });
      await seedPublicProfile({ orientation: null });
      await assertFails(updateDoc(doc(authenticatedDb(), 'public_profiles', UID), {
        orientation: 'bissexual', updatedAt: serverTimestamp(),
      }));
    }
  );

  it('permite somente o valor autorizado e a remoção da orientação pública', async () => {
    await seedUser({ orientation: 'bissexual', showOrientationPublicly: true });
    await seedPublicProfile({ orientation: null });
    const profile = doc(authenticatedDb(), 'public_profiles', UID);
    await assertFails(updateDoc(profile, {
      orientation: 'pansexual', updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(profile, {
      orientation: 'bissexual', updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(profile, {
      orientation: null, updatedAt: serverTimestamp(),
    }));
  });

  it('nega criar a projeção pelo cliente mesmo com conta plenamente elegível', async () => {
    await seedUser();
    const db = authenticatedDb();

    await assertFails(
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

  it('recusa criar projeção com nickname diferente do perfil privado', async () => {
    await seedUser();
    await assertFails(setDoc(doc(authenticatedDb(), 'public_profiles', UID), {
      ...publicProfile(), nickname: 'Perfil Impostor',
    }));
  });

  it('impede renomear nickname ou chave normalizada da projeção pública', async () => {
    await seedUser();
    await seedPublicProfile();
    const db = authenticatedDb();
    await assertFails(updateDoc(doc(db, 'public_profiles', UID), {
      nickname: 'Outro Apelido', updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(db, 'public_profiles', UID), {
      nicknameNormalized: 'outro_apelido', updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(doc(db, 'public_profiles', UID), {
      municipio: 'Niterói', updatedAt: serverTimestamp(),
    }));
  });

  it('permite editar a projeção sem revalidar assurance etário depois que a conta está ativa', async () => {
    await seedUser({}, false);
    await seedPublicProfile();
    const db = authenticatedDb();

    await assertSucceeds(
      updateDoc(doc(db, 'public_profiles', UID), { municipio: 'Niterói', updatedAt: serverTimestamp() })
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

  it('permite editar a projeção pública sem campo de consentimento legado', async () => {
    await seedUser();
    await seedPublicProfile();
    const db = authenticatedDb();
    await assertSucceeds(updateDoc(doc(db, 'public_profiles', UID), { municipio: 'Niterói', updatedAt: serverTimestamp() }));
  });

  it('permite editar a projeção com recusa do consentimento legado', async () => {
    await seedUser({ initialAdultConsentRequired: true, adultConsent: { accepted: false, version: 'v1' } });
    await seedPublicProfile();
    const db = authenticatedDb();
    await assertSucceeds(updateDoc(doc(db, 'public_profiles', UID), { municipio: 'Niterói', updatedAt: serverTimestamp() }));
  });

  it('permite editar a projeção com aceite de consentimento legado', async () => {
    await seedUser({ initialAdultConsentRequired: true, adultConsent: { accepted: true, version: 'v1' } });
    await seedPublicProfile();
    const db = authenticatedDb();
    await assertSucceeds(updateDoc(doc(db, 'public_profiles', UID), { municipio: 'Niterói', updatedAt: serverTimestamp() }));
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

  it('ignora campos etários legados na leitura de perfil ativo', async () => {
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

    await assertSucceeds(getDoc(doc(db, 'public_profiles', UID)));

    await seedPublicProfile({
      ageEligibilityVerifiedAdult: false,
      ageEligibilityValidUntil: new Date(Date.now() + 60_000),
    });

    await assertSucceeds(getDoc(doc(db, 'public_profiles', UID)));
  });

  it('nega a terceiro o GET de qualquer projeção legada com filtros privados', async () => {
    await seedUser();
    await seedVisitor();

    for (const privateKey of [
      'interestedInGenders',
      'interestedInOrientations',
      'preferences',
      'generosDeInteresse',
      'preferredGenders',
      'discoveryPreferences',
      'hardRules',
      'softRules',
      'matchingModes',
      'selfTraits',
    ]) {
      await seedPublicProfile({ [privateKey]: ['não autorizado'] });
      await assertFails(
        getDoc(doc(visitorDb(), 'public_profiles', UID))
      );
    }

    // O próprio dono continua tendo acesso à projeção para manutenção.
    await assertSucceeds(getDoc(doc(authenticatedDb(), 'public_profiles', UID)));

    // Backfill elimina as chaves em vez de deixar arrays vazios.
    await seedPublicProfile({
      publicSeekingGenders: ['women'],
      preferenceBadgesVisible: true,
    });
    const cleanRead = await assertSucceeds(
      getDoc(doc(visitorDb(), 'public_profiles', UID))
    );
    expect(cleanRead.data()?.['publicSeekingGenders']).toEqual(['women']);
    expect(cleanRead.data()).not.toHaveProperty('interestedInGenders');
  });

  it('limita a leitura direta de terceiros a localizações públicas aproximadas', async () => {
    await seedUser();
    await seedVisitor();

    await seedPublicProfile({ latitude: -22.93, longitude: -43.35, geohash: '75cjt' });
    await assertSucceeds(getDoc(doc(visitorDb(), 'public_profiles', UID)));

    await seedPublicProfile({ latitude: -22.93091, longitude: -43.35, geohash: '75cjt' });
    await assertFails(getDoc(doc(visitorDb(), 'public_profiles', UID)));
    await assertSucceeds(getDoc(doc(authenticatedDb(), 'public_profiles', UID)));
  });

  it('reserva a escrita das coordenadas públicas para a projeção do servidor', async () => {
    await seedUser();
    await seedPublicProfile();
    await assertFails(updateDoc(doc(authenticatedDb(), 'public_profiles', UID), {
      latitude: -22.93,
      longitude: -43.35,
      geohash: '75cjt',
      updatedAt: serverTimestamp(),
    }));
  });

  it('nega a visita após bloqueio bilateral, nos dois sentidos', async () => {
    await seedUser();
    await seedVisitor();
    await seedPublicProfile();

    await assertSucceeds(getDoc(doc(visitorDb(), 'public_profiles', UID)));

    await seedBilateralBlock(VISITOR_UID, UID);
    await assertFails(getDoc(doc(visitorDb(), 'public_profiles', UID)));

    await seedBilateralBlock(VISITOR_UID, UID, false);
    await seedBilateralBlock(UID, VISITOR_UID);
    await assertFails(getDoc(doc(visitorDb(), 'public_profiles', UID)));

    await seedBilateralBlock(UID, VISITOR_UID, false);
    await assertSucceeds(getDoc(doc(visitorDb(), 'public_profiles', UID)));
  });

  it('revalida ocultação e suspensão do visitado a cada GET', async () => {
    await seedUser();
    await seedVisitor();
    await seedPublicProfile();
    await assertSucceeds(getDoc(doc(visitorDb(), 'public_profiles', UID)));

    await seedUser({ publicVisibility: 'hidden' });
    await assertFails(getDoc(doc(visitorDb(), 'public_profiles', UID)));

    await seedUser({ accountStatus: 'moderation_suspended', suspended: true });
    await assertFails(getDoc(doc(visitorDb(), 'public_profiles', UID)));
  });

  it('não abre perfil visitado quando o visitante perdeu elegibilidade', async () => {
    await seedUser();
    await seedVisitor();
    await seedPublicProfile();
    await assertSucceeds(getDoc(doc(visitorDb(), 'public_profiles', UID)));

    await seedVisitor({ interactionBlocked: true });
    await assertFails(getDoc(doc(visitorDb(), 'public_profiles', UID)));
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
      where('role', '==', 'free')
    );

    await assertFails(getDocs(guardedQuery));
    await assertFails(getDocs(collection(db, 'public_profiles')));

    // Deep link documental continua disponível sob lifecycle canônico da conta.
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

  it('nega GET de perfil legado com email a terceiros', async () => {
    await seedUser();
    await seedVisitor();

    const privateKeys = [
      'email', 'emailAddress', 'registrationEmail',
      'authEmail', 'accountEmail', 'authorEmail',
    ];

    for (const key of privateKeys) {
      await seedPublicProfile({
        [key]: 'privado@example.invalid',
      });

      await assertFails(
        getDoc(doc(visitorDb(), 'public_profiles', UID))
      );

      await assertSucceeds(
        getDoc(doc(authenticatedDb(), 'public_profiles', UID))
      );
    }

    await seedPublicProfile();

    const clean = await assertSucceeds(
      getDoc(doc(visitorDb(), 'public_profiles', UID))
    );

    expect(clean.data()).not.toHaveProperty('email');
  });


  it('isola o email cadastral entre duas contas', async () => {
    const ownerEmail = 'titular@cadastro.invalid';
    const visitorEmail = 'visitante@cadastro.invalid';

    await seedUser({ email: ownerEmail });
    await seedVisitor({ email: visitorEmail });
    await seedPublicProfile();

    const ownerPrivate = await assertSucceeds(
      getDoc(doc(authenticatedDb(), 'users', UID))
    );

    expect(ownerPrivate.data()?.['email'])
      .toBe(ownerEmail);

    const visitorPrivate = await assertSucceeds(
      getDoc(doc(visitorDb(), 'users', VISITOR_UID))
    );

    expect(visitorPrivate.data()?.['email'])
      .toBe(visitorEmail);

    await assertFails(
      getDoc(doc(visitorDb(), 'users', UID))
    );

    await assertFails(
      getDoc(doc(authenticatedDb(), 'users', VISITOR_UID))
    );

    const publicProfileRead = await assertSucceeds(
      getDoc(doc(visitorDb(), 'public_profiles', UID))
    );

    expect(publicProfileRead.data()).not.toHaveProperty('email');
    expect(JSON.stringify(publicProfileRead.data()))
      .not.toContain(ownerEmail);
  });

  it('mantém a descrição voluntária e bloqueia campos privados em alterações de avatar', async () => {
    const email = 'dono+teste@cadastro.invalid';
    const publicDescription = `Olá\nUse ${email} para contato`;
    await seedUser({ email });
    await seedVisitor();
    await seedPublicProfile({ publicDescription });
    const ownRef = doc(authenticatedDb(), 'public_profiles', UID);

    await assertFails(updateDoc(ownRef, {
      photoURL: 'https://example.invalid/avatar.png',
      contacto: { endereco: email },
      updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(ownRef, {
      photoURL: { email },
      updatedAt: serverTimestamp(),
    }));
    const visited = await assertSucceeds(getDoc(doc(visitorDb(), 'public_profiles', UID)));
    expect(visited.data()?.['publicDescription']).toBe(publicDescription);
    expect(visited.data()).not.toHaveProperty('email');
  });

  it('restringe o documento privado ao titular, inclusive diante de uma conta administrativa', async () => {
    await seedUser({ email: 'privado@cadastro.invalid' });
    await seedVisitor({ role: 'admin' });
    const admin = testEnv.authenticatedContext(VISITOR_UID, { admin: true, email_verified: true }).firestore();
    await assertFails(getDoc(doc(admin, 'users', UID)));
    await assertFails(updateDoc(doc(authenticatedDb(), 'users', UID), {
      email: 'outro@cadastro.invalid',
    }));
  });

});
