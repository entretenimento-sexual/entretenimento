// firestore-rules/tests/community-member-management-index.rules.spec.ts
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
const USER_UID = 'community-admin-index-viewer';
const PROJECTION_ID = 'community-1:member-1';

let testEnv: RulesTestEnvironment;

describe('Firestore Rules / community_member_management_index', () => {
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
          'community_member_management_index',
          PROJECTION_ID
        ),
        {
          communityId: 'community-1',
          memberId: 'member-1',
          status: 'active',
          managementRole: 'admin',
          leadership: true,
          label: 'Pessoa Um',
          sortLabel: 'pessoa um',
          searchPrefixes: ['pe', 'pes', 'pessoa'],
        }
      );
    });
  });

  afterAll(async () => testEnv.cleanup());

  it('nega get/list até para usuário autenticado', async () => {
    const db = testEnv.authenticatedContext(USER_UID).firestore();

    await assertFails(
      getDoc(doc(db, 'community_member_management_index', PROJECTION_ID))
    );
    await assertFails(
      getDocs(collection(db, 'community_member_management_index'))
    );
  });

  it('nega escrita direta do navegador', async () => {
    const db = testEnv.authenticatedContext(USER_UID).firestore();

    await assertFails(
      setDoc(
        doc(db, 'community_member_management_index', 'community-1:member-2'),
        {
          communityId: 'community-1',
          memberId: 'member-2',
          status: 'active',
          managementRole: 'member',
        }
      )
    );
  });

  it('nega leitura sem autenticação', async () => {
    const db = testEnv.unauthenticatedContext().firestore();

    await assertFails(
      getDoc(doc(db, 'community_member_management_index', PROJECTION_ID))
    );
  });
});
