// firestore-rules/tests/community-membership-audit.rules.spec.ts
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
const USER_UID = 'community-audit-user';

let testEnv: RulesTestEnvironment;

describe('Firestore Rules / community_membership_audit', () => {
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

    await assertFails(
      getDoc(doc(db, 'community_membership_audit', 'audit-1'))
    );
    await assertFails(getDocs(collection(db, 'community_membership_audit')));
  });

  it('nega criação direta de auditoria pelo cliente', async () => {
    const db = testEnv.authenticatedContext(USER_UID).firestore();

    await assertFails(
      setDoc(doc(db, 'community_membership_audit', 'audit-1'), {
        action: 'community-membership-joined',
        actorUid: USER_UID,
        communityId: 'community-1',
      })
    );
  });
});
