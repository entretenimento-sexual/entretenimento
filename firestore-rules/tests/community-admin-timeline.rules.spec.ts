import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, describe, it } from 'vitest';

const PROJECT_ID = 'demo-entretenimento-rules';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8180;
const USER_UID = 'community-admin-timeline-user';

let testEnv: RulesTestEnvironment;

describe('Firestore Rules / community_admin_timeline', () => {
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

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('nega leitura individual e listagem ao cliente autenticado', async () => {
    const db = testEnv.authenticatedContext(USER_UID).firestore();
    const items = collection(
      db,
      'community_admin_timeline',
      'community-1',
      'items'
    );

    await assertFails(getDocs(items));
    await assertFails(getDoc(doc(items, 'event-1')));
  });

  it('nega escrita direta da projeção pelo cliente', async () => {
    const db = testEnv.authenticatedContext(USER_UID).firestore();

    await assertFails(
      setDoc(
        doc(
          db,
          'community_admin_timeline',
          'community-1',
          'items',
          'event-1'
        ),
        {
          eventType: 'member_blocked',
          createdAtMs: 1,
        }
      )
    );
  });
});
