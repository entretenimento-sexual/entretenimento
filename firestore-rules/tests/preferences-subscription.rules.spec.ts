// firestore-rules/tests/preferences-subscription.rules.spec.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { Timestamp, doc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const PROJECT_ID = 'demo-entretenimento-preferences-rules';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8180;
let testEnv: RulesTestEnvironment;

function authenticatedDb(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}

async function seedUser(uid: string, role: 'free' | 'basic' | 'premium' | 'vip'): Promise<void> {
  const now = Date.now();
  const active = role !== 'free';
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', uid), {
      uid,
      role,
      tier: role,
      billingProjectionVersion: 1,
      isSubscriber: active,
      subscriptionStatus: active ? 'active' : 'inactive',
      subscriptionScope: active ? 'platform_subscription' : null,
      subscriptionStartedAt: active ? Timestamp.fromMillis(now - 60_000) : null,
      subscriptionEndsAt: active ? Timestamp.fromMillis(now + 3_600_000) : null,
    });
  });
}

function profilePayload(
  uid: string,
  options: {
    bodyPreferences?: string[];
    sexualPractices?: string[];
    bodyTraits?: string[];
    sexualPracticeMode?: 'prefer' | 'require';
    bodyPreferenceMode?: 'prefer' | 'require';
    discoveryMode?: 'standard' | 'discreet' | 'priority';
    ageRange?: { min: number; max: number } | null;
  } = {}
) {
  return {
    userId: uid,
    relationshipIntents: ['friendship'],
    hardRules: {
      acceptedGenders: ['women'],
      acceptedRelationshipIntents: ['friendship'],
      ageRange: options.ageRange ?? null,
      maxDistanceKm: 20,
      acceptsCouples: true,
      acceptsSingles: true,
      acceptsTransProfiles: null,
      locationRequired: false,
    },
    softRules: {
      bodyPreferences: options.bodyPreferences ?? [],
      sexualPractices: options.sexualPractices ?? [],
      vibes: [], styles: [], interests: [],
    },
    selfTraits: { bodyTraits: options.bodyTraits ?? [] },
    matchingModes: {
      relationshipIntents: 'require',
      sexualPractices: options.sexualPracticeMode ?? 'prefer',
      bodyPreferences: options.bodyPreferenceMode ?? 'prefer',
    },
    visibility: {
      showPreferenceBadges: true,
      showIntentPublicly: false,
      discoveryMode: options.discoveryMode ?? 'standard',
    },
    updatedAt: Date.now(),
  };
}

function intentPayload(uid: string, contextual = false) {
  return {
    userId: uid,
    mode: 'chat',
    availableNow: true,
    availableToday: false,
    cityOverride: contextual ? 'Rio de Janeiro' : null,
    expiresAt: contextual ? Date.now() + 3_600_000 : null,
    tags: contextual ? ['fim de semana'] : [],
    updatedAt: Date.now(),
  };
}

describe('Firestore Rules / preference subscription tiers', () => {
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
    await seedUser('free-user', 'free');
    await seedUser('basic-user', 'basic');
    await seedUser('premium-user', 'premium');
    await seedUser('vip-user', 'vip');
  });

  afterAll(async () => testEnv.cleanup());

  it('permite filtros essenciais e autodescrição no plano gratuito', async () => {
    const db = authenticatedDb('free-user');
    await assertSucceeds(setDoc(
      doc(db, 'users', 'free-user', 'preferences', 'profile'),
      profilePayload('free-user', {
        bodyTraits: ['tattoos'],
        ageRange: { min: 25, max: 45 },
      })
    ));
  });

  it('nega preferências avançadas sem Básico ativo', async () => {
    const db = authenticatedDb('free-user');
    await assertFails(setDoc(
      doc(db, 'users', 'free-user', 'preferences', 'profile'),
      profilePayload('free-user', {
        bodyPreferences: ['athletic'],
        sexualPractices: ['bdsm'],
      })
    ));
  });

  it('Básico pode preferir avançadas, mas não exigi-las', async () => {
    const db = authenticatedDb('basic-user');
    await assertSucceeds(setDoc(
      doc(db, 'users', 'basic-user', 'preferences', 'profile'),
      profilePayload('basic-user', {
        bodyPreferences: ['athletic'],
        sexualPractices: ['bdsm'],
      })
    ));

    await assertFails(setDoc(
      doc(db, 'users', 'basic-user', 'preferences', 'profile'),
      profilePayload('basic-user', {
        bodyPreferences: ['athletic'],
        bodyPreferenceMode: 'require',
      })
    ));
  });

  it('Premium pode transformar preferências avançadas em filtros obrigatórios', async () => {
    const db = authenticatedDb('premium-user');
    await assertSucceeds(setDoc(
      doc(db, 'users', 'premium-user', 'preferences', 'profile'),
      profilePayload('premium-user', {
        bodyPreferences: ['athletic'],
        sexualPractices: ['bdsm'],
        bodyPreferenceMode: 'require',
        sexualPracticeMode: 'require',
      })
    ));
  });

  it('exige Premium para discreto e VIP para prioridade', async () => {
    await assertFails(setDoc(
      doc(authenticatedDb('basic-user'), 'users', 'basic-user', 'preferences', 'profile'),
      profilePayload('basic-user', { discoveryMode: 'discreet' })
    ));
    await assertSucceeds(setDoc(
      doc(authenticatedDb('premium-user'), 'users', 'premium-user', 'preferences', 'profile'),
      profilePayload('premium-user', { discoveryMode: 'discreet' })
    ));
    await assertFails(setDoc(
      doc(authenticatedDb('premium-user'), 'users', 'premium-user', 'preferences', 'profile'),
      profilePayload('premium-user', { discoveryMode: 'priority' })
    ));
    await assertSucceeds(setDoc(
      doc(authenticatedDb('vip-user'), 'users', 'vip-user', 'preferences', 'profile'),
      profilePayload('vip-user', { discoveryMode: 'priority' })
    ));
  });

  it('nega faixa etária inválida', async () => {
    await assertFails(setDoc(
      doc(authenticatedDb('free-user'), 'users', 'free-user', 'preferences', 'profile'),
      profilePayload('free-user', { ageRange: { min: 50, max: 25 } })
    ));
  });

  it('preserva seleções pagas após downgrade, mas nega alteração', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'users', 'free-user', 'preferences', 'profile'),
        profilePayload('free-user', {
          bodyPreferences: ['athletic'],
          sexualPractices: ['bdsm'],
          bodyPreferenceMode: 'require',
        })
      );
    });

    const ref = doc(authenticatedDb('free-user'), 'users', 'free-user', 'preferences', 'profile');
    await assertSucceeds(updateDoc(ref, {
      relationshipIntents: ['friendship', 'dating'],
      'selfTraits.bodyTraits': ['tattoos'],
      updatedAt: Date.now(),
    }));
    await assertFails(updateDoc(ref, {
      'softRules.bodyPreferences': ['curvy'],
      updatedAt: Date.now(),
    }));
  });

  it('mantém contexto de disponibilidade no Básico', async () => {
    await assertFails(setDoc(
      doc(authenticatedDb('free-user'), 'users', 'free-user', 'preferences', 'intent'),
      intentPayload('free-user', true)
    ));
    await assertSucceeds(setDoc(
      doc(authenticatedDb('basic-user'), 'users', 'basic-user', 'preferences', 'intent'),
      intentPayload('basic-user', true)
    ));
  });
});
