// firestore-rules/tests/community-discovery-index.rules.spec.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const PROJECT_ID = 'demo-entretenimento-rules';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8180;
const USER_UID = 'community-index-viewer';
const COMMUNITY_ID = 'community-index-item';

let testEnv: RulesTestEnvironment;

function projectionDocument() {
  return {
    name: 'Comunidade indexada',
    slug: 'comunidade-indexada',
    source: { type: 'venue', id: 'venue-1' },
    status: 'active',
    moderationState: 'active',
    visibility: 'public_preview',
    rankScore: 100,
    metrics: { memberCount: 1, postCount: 0, mediaCount: 0 },
    access: { join: 'approval' },
  };
}

describe('Firestore Rules / community_discovery_index', () => {
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
      await setDoc(
        doc(context.firestore(), 'community_discovery_index', COMMUNITY_ID),
        projectionDocument()
      );
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('nega leitura individual e listagem ao cliente autenticado', async () => {
    const db = testEnv.authenticatedContext(USER_UID).firestore();

    await assertFails(
      getDoc(doc(db, 'community_discovery_index', COMMUNITY_ID))
    );
    await assertFails(getDocs(collection(db, 'community_discovery_index')));
  });

  it('nega leitura sem autenticação', async () => {
    const db = testEnv.unauthenticatedContext().firestore();

    await assertFails(
      getDoc(doc(db, 'community_discovery_index', COMMUNITY_ID))
    );
  });

  it('nega criação direta pelo cliente autenticado', async () => {
    const db = testEnv.authenticatedContext(USER_UID).firestore();

    await assertFails(
      setDoc(
        doc(db, 'community_discovery_index', 'client-created'),
        projectionDocument()
      )
    );
  });
});
