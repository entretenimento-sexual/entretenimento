// firestore-rules/tests/exclusive-connection-candidates.rules.spec.ts
// -----------------------------------------------------------------------------
// FIRESTORE SECURITY RULES - EXCLUSIVE CONNECTION CANDIDATES
// -----------------------------------------------------------------------------
// Prova que a projeção de assinantes permanece backend-only.
// Nem o próprio viewer pode ler, listar ou alterar candidatos pelo SDK cliente.
// -----------------------------------------------------------------------------

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
const VIEWER_UID = 'exclusive-viewer-user';
const CANDIDATE_UID = 'exclusive-candidate-user';

let testEnv: RulesTestEnvironment;

function authenticatedDb() {
  return testEnv
    .authenticatedContext(VIEWER_UID, { email_verified: true })
    .firestore();
}

async function seedDatabase(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(
      doc(
        db,
        'exclusive_connection_candidates',
        VIEWER_UID,
        'items',
        CANDIDATE_UID
      ),
      {
        candidateUid: CANDIDATE_UID,
        nickname: 'Pessoa Teste',
        photoURL: null,
        region: { uf: 'RJ', city: 'Niterói' },
        compatibilityScore: 88,
        intentLabel: 'Disponível hoje',
        reasonTags: ['Mesma região'],
        status: 'active',
        expiresAt: Date.now() + 60_000,
      }
    );
  });
}

describe('Firestore Rules / exclusive_connection_candidates', () => {
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

  it('nega leitura do documento pai ao próprio viewer', async () => {
    const db = authenticatedDb();

    await assertFails(
      getDoc(doc(db, 'exclusive_connection_candidates', VIEWER_UID))
    );
  });

  it('nega leitura individual e listagem dos candidatos', async () => {
    const db = authenticatedDb();
    const candidateRef = doc(
      db,
      'exclusive_connection_candidates',
      VIEWER_UID,
      'items',
      CANDIDATE_UID
    );

    await assertFails(getDoc(candidateRef));
    await assertFails(
      getDocs(
        collection(
          db,
          'exclusive_connection_candidates',
          VIEWER_UID,
          'items'
        )
      )
    );
  });

  it('nega criação direta de candidato', async () => {
    const db = authenticatedDb();

    await assertFails(
      setDoc(
        doc(
          db,
          'exclusive_connection_candidates',
          VIEWER_UID,
          'items',
          'candidate-created-by-client'
        ),
        {
          candidateUid: 'candidate-created-by-client',
          compatibilityScore: 100,
          status: 'active',
        }
      )
    );
  });

  it('nega atualização e exclusão direta', async () => {
    const db = authenticatedDb();
    const candidateRef = doc(
      db,
      'exclusive_connection_candidates',
      VIEWER_UID,
      'items',
      CANDIDATE_UID
    );

    await assertFails(updateDoc(candidateRef, { compatibilityScore: 100 }));
    await assertFails(deleteDoc(candidateRef));
  });

  it('nega acesso sem autenticação', async () => {
    const db = testEnv.unauthenticatedContext().firestore();

    await assertFails(
      getDoc(
        doc(
          db,
          'exclusive_connection_candidates',
          VIEWER_UID,
          'items',
          CANDIDATE_UID
        )
      )
    );
  });
});
