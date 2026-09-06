// firestore-rules/tests/community-profile-membership-index.rules.spec.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const PROJECT_ID = 'demo-entretenimento-rules';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8180;
const USER_UID = 'profile-membership-viewer';
const COMMUNITY_ID = 'profile-membership-community';

let testEnv: RulesTestEnvironment;

describe('Firestore Rules / community_profile_membership_index', () => {
  beforeAll(async () => {
    const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
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
        doc(
          context.firestore(),
          'community_profile_membership_index',
          USER_UID,
          'items',
          COMMUNITY_ID
        ),
        { communityId: COMMUNITY_ID, status: 'candidate' }
      );
    });
  });

  afterAll(async () => testEnv.cleanup());

  it('nega get e list do locator até para o próprio usuário', async () => {
    const db = testEnv.authenticatedContext(USER_UID).firestore();
    await assertFails(
      getDoc(
        doc(
          db,
          'community_profile_membership_index',
          USER_UID,
          'items',
          COMMUNITY_ID
        )
      )
    );
    await assertFails(
      getDocs(
        collection(db, 'community_profile_membership_index', USER_UID, 'items')
      )
    );
  });

  it('nega escrita direta do navegador', async () => {
    const db = testEnv.authenticatedContext(USER_UID).firestore();
    await assertFails(
      setDoc(
        doc(
          db,
          'community_profile_membership_index',
          USER_UID,
          'items',
          'client-created'
        ),
        { communityId: 'client-created', status: 'candidate' }
      )
    );
  });

  it('nega leitura sem autenticação', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      getDoc(
        doc(
          db,
          'community_profile_membership_index',
          USER_UID,
          'items',
          COMMUNITY_ID
        )
      )
    );
  });
});
