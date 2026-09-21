// firestore-rules/tests/community-boost.rules.spec.ts
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
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  it,
} from 'vitest';

const PROJECT_ID = 'demo-entretenimento-rules';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8180;
const USER_UID = 'community-boost-rules-user';

let testEnv: RulesTestEnvironment;

describe('Firestore Rules / Community Boost backend-only', () => {
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

  it('nega leitura e escrita em campanhas, placements e caps', async () => {
    const db = testEnv.authenticatedContext(USER_UID).firestore();

    for (const [collectionName, documentId] of [
      ['community_boost_advertiser_accounts', USER_UID],
      ['community_boost_advertiser_account_requests', 'request-0'],
      ['community_boost_active_slots', 'community-1'],
      ['community_boost_campaigns', 'campaign-1'],
      ['community_boost_placements', 'placement-1'],
      ['community_boost_frequency_caps', 'cap-1'],
      ['community_boost_campaign_requests', 'request-1'],
      ['community_boost_billing_config', 'current'],
      ['community_boost_billing_config_requests', 'request-2'],
      ['community_boost_audit', 'audit-1'],
    ] as const) {
      const reference = doc(db, collectionName, documentId);
      await assertFails(getDoc(reference));
      await assertFails(setDoc(reference, { forged: true }));
    }
  });

  it('nega enumeração e subcoleções agregadas da campanha', async () => {
    const db = testEnv.authenticatedContext(USER_UID).firestore();

    await assertFails(
      getDocs(collection(db, 'community_boost_campaigns'))
    );
    await assertFails(
      getDoc(doc(
        db,
        'community_boost_campaigns',
        'campaign-1',
        'metrics_daily',
        '2026-09-21'
      ))
    );
    await assertFails(
      getDoc(doc(
        db,
        'community_boost_campaigns',
        'campaign-1',
        'billing_ledger',
        '2026-09-21'
      ))
    );
  });
});
