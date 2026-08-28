// firestore-rules/tests/discovery-preferences-projection.rules.spec.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const PROJECT_ID = 'demo-discovery-preference-projection-rules';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8180;
let testEnv: RulesTestEnvironment;

function authenticatedDb(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}

function profilePayload(uid: string) {
  return {
    userId: uid,
    relationshipIntents: ['friendship'],
    hardRules: {
      acceptedGenders: ['women', 'couple_mf'],
      acceptedRelationshipIntents: ['friendship'],
      ageRange: { min: 25, max: 45 },
      maxDistanceKm: 20,
      acceptsCouples: true,
      acceptsSingles: true,
      acceptsTransProfiles: null,
      locationRequired: false,
    },
    softRules: {
      bodyPreferences: [],
      sexualPractices: [],
      vibes: [],
      styles: [],
      interests: [],
    },
    selfTraits: { bodyTraits: ['tattoos'] },
    matchingModes: {
      relationshipIntents: 'require',
      sexualPractices: 'prefer',
      bodyPreferences: 'prefer',
    },
    visibility: {
      showPreferenceBadges: true,
      showIntentPublicly: false,
      discoveryMode: 'standard',
    },
    updatedAt: Date.now(),
  };
}

function discoveryProjection() {
  return {
    interestedInGenders: ['woman', 'couple'],
    discoveryPreferences: {
      genderInterests: ['women', 'couple_mf'],
      relationshipIntents: ['friendship'],
      acceptsCouples: true,
      acceptsSingles: true,
      acceptsTransProfiles: null,
      ageRange: { min: 25, max: 45 },
      maxDistanceKm: 20,
      locationRequired: false,
      relationshipIntentMode: 'require',
      sexualPractices: [],
      sexualPracticeMode: 'prefer',
      bodyPreferences: [],
      bodyPreferenceMode: 'prefer',
      updatedAt: Date.now(),
    },
    discoveryPreferencesUpdatedAt: Date.now(),
  };
}

describe('Firestore Rules / atomic discovery preference projection', () => {
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
    await testEnv.withSecurityRulesDisabled(async (context) => {
      for (const uid of ['owner', 'attacker']) {
        await setDoc(doc(context.firestore(), 'users', uid), {
          uid,
          role: 'free',
          tier: 'free',
          billingProjectionVersion: 1,
          isSubscriber: false,
          subscriptionStatus: 'inactive',
          subscriptionScope: null,
        });
      }
    });
  });

  afterAll(async () => testEnv.cleanup());

  it('permite ao proprietário salvar perfil e projeção no mesmo batch', async () => {
    const db = authenticatedDb('owner');
    const batch = writeBatch(db);
    batch.set(
      doc(db, 'users', 'owner', 'preferences', 'profile'),
      profilePayload('owner')
    );
    batch.set(
      doc(db, 'users', 'owner'),
      discoveryProjection(),
      { merge: true }
    );

    await assertSucceeds(batch.commit());
  });

  it('nega alteração da projeção privada de outro usuário', async () => {
    const db = authenticatedDb('attacker');
    const batch = writeBatch(db);
    batch.set(
      doc(db, 'users', 'owner'),
      discoveryProjection(),
      { merge: true }
    );

    await assertFails(batch.commit());
  });

  it('nega projeção privada incompleta mesmo para o proprietário', async () => {
    const db = authenticatedDb('owner');

    await assertFails(
      setDoc(
        doc(db, 'users', 'owner'),
        {
          interestedInGenders: ['woman'],
          discoveryPreferences: {
            genderInterests: ['women'],
            // demais campos obrigatórios foram omitidos deliberadamente
          },
          discoveryPreferencesUpdatedAt: Date.now(),
        },
        { merge: true }
      )
    );
  });

  it('nega listas acima dos limites definidos', async () => {
    const db = authenticatedDb('owner');
    const projection = discoveryProjection();

    await assertFails(
      setDoc(
        doc(db, 'users', 'owner'),
        {
          ...projection,
          discoveryPreferences: {
            ...projection.discoveryPreferences,
            bodyPreferences: Array.from(
              { length: 31 },
              (_, index) => `trait-${index}`
            ),
          },
        },
        { merge: true }
      )
    );
  });

  it('não permite misturar a projeção privada com campo financeiro ou de plano', async () => {
    const db = authenticatedDb('owner');

    await assertFails(
      setDoc(
        doc(db, 'users', 'owner'),
        {
          ...discoveryProjection(),
          role: 'vip',
          tier: 'vip',
          isSubscriber: true,
        },
        { merge: true }
      )
    );
  });
});
