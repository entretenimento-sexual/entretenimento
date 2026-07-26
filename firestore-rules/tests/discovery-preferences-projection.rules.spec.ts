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
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  it,
} from 'vitest';

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
      ageRange: null,
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
      acceptsCouples: true,
      acceptsSingles: true,
      acceptsTransProfiles: null,
      updatedAt: Date.now(),
    },
    discoveryPreferencesUpdatedAt: Date.now(),
  };
}

describe('Firestore Rules / atomic discovery preference projection', () => {
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

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', 'owner'), {
        uid: 'owner',
        role: 'free',
        tier: 'free',
        billingProjectionVersion: 1,
        isSubscriber: false,
        subscriptionStatus: 'inactive',
        subscriptionScope: null,
      });

      await setDoc(doc(context.firestore(), 'users', 'attacker'), {
        uid: 'attacker',
        role: 'free',
        tier: 'free',
        billingProjectionVersion: 1,
        isSubscriber: false,
        subscriptionStatus: 'inactive',
        subscriptionScope: null,
      });
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

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
});
