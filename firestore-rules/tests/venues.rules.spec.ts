// firestore-rules/tests/venues.rules.spec.ts
// -----------------------------------------------------------------------------
// FIRESTORE SECURITY RULES - VENUES
// -----------------------------------------------------------------------------
// Protege o catálogo moderado e a separação entre política de chat e salas.
// -----------------------------------------------------------------------------

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
  setDoc,
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
const USER_UID = 'venue-viewer';
const ADMIN_UID = 'venue-admin';
const ACTIVE_VENUE_ID = 'venue-active';
const HIDDEN_VENUE_ID = 'venue-hidden';

let testEnv: RulesTestEnvironment;

function venueDocument(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Local moderado',
    slug: 'local-moderado',
    kind: 'bar',
    description: 'Local fictício para teste.',
    region: {
      uf: 'RJ',
      city: 'rio de janeiro',
      district: 'Centro',
    },
    addressHint: 'Região central',
    visibility: 'public',
    moderation: {
      state: 'active',
      reviewedAt: new Date(),
      reviewedBy: ADMIN_UID,
      reason: 'approved-for-test',
    },
    sponsorship: {
      state: 'none',
      priority: 0,
      startsAt: null,
      endsAt: null,
    },
    chat: {
      enabled: true,
      mode: 'hybrid',
    },
    ownerUid: null,
    adminUids: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function userDb() {
  return testEnv.authenticatedContext(USER_UID).firestore();
}

function adminDb() {
  return testEnv
    .authenticatedContext(ADMIN_UID, { admin: true })
    .firestore();
}

async function seedVenues(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await Promise.all([
      setDoc(doc(db, 'venues', ACTIVE_VENUE_ID), venueDocument()),
      setDoc(
        doc(db, 'venues', HIDDEN_VENUE_ID),
        venueDocument({
          visibility: 'hidden',
          moderation: {
            state: 'hidden',
            reviewedAt: new Date(),
            reviewedBy: ADMIN_UID,
            reason: 'hidden-for-test',
          },
        })
      ),
    ]);
  });
}

describe('Firestore Rules / venues', () => {
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
    await seedVenues();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('permite leitura individual de local ativo e visível', async () => {
    const snapshot = await assertSucceeds(
      getDoc(doc(userDb(), 'venues', ACTIVE_VENUE_ID))
    );

    expect(snapshot.exists()).toBe(true);
  });

  it('permite consulta regional somente de locais ativos e visíveis', async () => {
    const venuesQuery = query(
      collection(userDb(), 'venues'),
      where('region.uf', '==', 'RJ'),
      where('region.city', '==', 'rio de janeiro'),
      where('moderation.state', '==', 'active'),
      where('visibility', 'in', ['public', 'members_only'])
    );

    const snapshot = await assertSucceeds(getDocs(venuesQuery));

    expect(snapshot.docs.map((item) => item.id)).toEqual([ACTIVE_VENUE_ID]);
  });

  it('nega leitura de local oculto', async () => {
    await assertFails(getDoc(doc(userDb(), 'venues', HIDDEN_VENUE_ID)));
  });

  it('nega criação direta por usuário comum', async () => {
    await assertFails(
      setDoc(doc(userDb(), 'venues', 'venue-client-created'), venueDocument())
    );
  });

  it('permite payload administrativo válido e rejeita chat.roomId', async () => {
    await assertSucceeds(
      setDoc(doc(adminDb(), 'venues', 'venue-admin-valid'), venueDocument())
    );

    await assertFails(
      setDoc(
        doc(adminDb(), 'venues', 'venue-admin-invalid-room'),
        venueDocument({
          chat: {
            enabled: true,
            mode: 'hybrid',
            roomId: 'room-singular-invalid',
          },
        })
      )
    );
  });
});
