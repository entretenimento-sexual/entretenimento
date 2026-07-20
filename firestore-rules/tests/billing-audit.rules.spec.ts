// firestore-rules/tests/billing-audit.rules.spec.ts
// -----------------------------------------------------------------------------
// FIRESTORE SECURITY RULES - FINANCIAL RETENTION AUDITS
// -----------------------------------------------------------------------------
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
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
const USER_UID = 'billing-audit-user';

let testEnv: RulesTestEnvironment;

function authenticatedDb() {
  return testEnv.authenticatedContext(USER_UID).firestore();
}

function unauthenticatedDb() {
  return testEnv.unauthenticatedContext().firestore();
}

describe('Firestore Rules / financial retention audits', () => {
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

  it('nega leitura e escrita autenticada no arquivo de checkouts', async () => {
    const reference = doc(
      authenticatedDb(),
      'financial_checkout_audit',
      'checkout-audit-001'
    );

    await assertFails(getDoc(reference));
    await assertFails(setDoc(reference, { status: 'canceled' }));
  });

  it('nega leitura e escrita autenticada no arquivo de entitlements', async () => {
    const reference = doc(
      authenticatedDb(),
      'financial_entitlement_audit',
      'entitlement-audit-001'
    );

    await assertFails(getDoc(reference));
    await assertFails(setDoc(reference, { active: false }));
  });

  it('nega leitura sem autenticação nos dois arquivos financeiros', async () => {
    const db = unauthenticatedDb();
    const checkoutReference = doc(
      db,
      'financial_checkout_audit',
      'checkout-audit-002'
    );
    const entitlementReference = doc(
      db,
      'financial_entitlement_audit',
      'entitlement-audit-002'
    );

    await assertFails(getDoc(checkoutReference));
    await assertFails(getDoc(entitlementReference));
  });
});
