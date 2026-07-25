// firestore-rules/tests/compliance-deny.rules.spec.ts
// -----------------------------------------------------------------------------
// FIRESTORE SECURITY RULES - COMPLIANCE / KYC / AML
// -----------------------------------------------------------------------------
//
// Prova que dados internos de compliance e repasse permanecem inacessíveis pelo
// SDK cliente, independentemente de autenticação ou claims administrativas.
//
// Os documentos de teste usam somente valores sintéticos. Nenhum CPF,
// documento, biometria ou payload bruto de provedor é criado nesta suíte.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const PROJECT_ID = 'demo-entretenimento-rules';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8180;

const USER_UID = 'compliance-user';
const ADMIN_UID = 'compliance-admin';

interface InternalCollectionCase {
  collectionName: string;
  documentId: string;
  document: Record<string, unknown>;
}

const INTERNAL_COLLECTIONS: InternalCollectionCase[] = [
  {
    collectionName: 'compliance_profiles',
    documentId: USER_UID,
    document: {
      ageVerificationStatus: 'approved',
      identityVerificationStatus: 'approved',
      identityVerificationProvider: 'synthetic-provider',
      amlRiskTier: 'low',
      updatedAt: new Date(),
    },
  },
  {
    collectionName: 'identity_verification_events',
    documentId: 'identity-event-001',
    document: {
      uid: USER_UID,
      eventType: 'verification.updated',
      providerEventId: 'synthetic-identity-event',
      receivedAt: new Date(),
    },
  },
  {
    collectionName: 'aml_risk_events',
    documentId: 'aml-event-001',
    document: {
      uid: USER_UID,
      riskTier: 'low',
      source: 'synthetic-test',
      reviewedAt: new Date(),
    },
  },
  {
    collectionName: 'compliance_audit',
    documentId: 'compliance-audit-001',
    document: {
      actorUid: USER_UID,
      action: 'synthetic_compliance_review',
      createdAt: new Date(),
    },
  },
  {
    collectionName: 'payout_accounts',
    documentId: USER_UID,
    document: {
      uid: USER_UID,
      payoutAccountStatus: 'active',
      provider: 'synthetic-provider',
      updatedAt: new Date(),
    },
  },
];

let testEnv: RulesTestEnvironment;

function authenticatedDb(uid = USER_UID) {
  return testEnv.authenticatedContext(uid, {
    email_verified: true,
  }).firestore();
}

function adminDb() {
  return testEnv.authenticatedContext(ADMIN_UID, {
    email_verified: true,
    admin: true,
    role: 'admin',
  }).firestore();
}

async function seedDatabase(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await Promise.all(
      INTERNAL_COLLECTIONS.map((entry) =>
        setDoc(
          doc(db, entry.collectionName, entry.documentId),
          entry.document
        )
      )
    );
  });
}

describe('Firestore Rules / compliance deny-by-default', () => {
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
    await seedDatabase();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  describe.each(INTERNAL_COLLECTIONS)(
    '$collectionName',
    ({ collectionName, documentId }) => {
      it('nega leitura individual sem autenticação', async () => {
        const db = testEnv.unauthenticatedContext().firestore();

        await assertFails(getDoc(doc(db, collectionName, documentId)));
      });

      it('nega leitura individual ao próprio usuário autenticado', async () => {
        const db = authenticatedDb();

        await assertFails(getDoc(doc(db, collectionName, documentId)));
      });

      it('nega leitura individual mesmo com claim administrativa no cliente', async () => {
        const db = adminDb();

        await assertFails(getDoc(doc(db, collectionName, documentId)));
      });

      it('nega listagem ao usuário autenticado', async () => {
        const db = authenticatedDb();

        await assertFails(getDocs(collection(db, collectionName)));
      });

      it('nega criação direta ao usuário autenticado', async () => {
        const db = authenticatedDb();

        await assertFails(
          setDoc(doc(db, collectionName, 'client-created-document'), {
            synthetic: true,
          })
        );
      });

      it('nega criação direta mesmo com claim administrativa no cliente', async () => {
        const db = adminDb();

        await assertFails(
          setDoc(doc(db, collectionName, 'admin-client-created-document'), {
            synthetic: true,
          })
        );
      });

      it('nega atualização direta ao usuário autenticado', async () => {
        const db = authenticatedDb();

        await assertFails(
          updateDoc(doc(db, collectionName, documentId), {
            tamperedByClient: true,
          })
        );
      });

      it('nega exclusão direta ao usuário autenticado', async () => {
        const db = authenticatedDb();

        await assertFails(deleteDoc(doc(db, collectionName, documentId)));
      });
    }
  );
});
