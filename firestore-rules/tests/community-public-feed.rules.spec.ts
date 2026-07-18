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
const COMMUNITY_ID = 'community-feed';
const POST_ID = 'post-1';
let testEnv: RulesTestEnvironment;

function postData() {
  return {
    kind: 'photo',
    audience: 'public_preview',
    status: 'active',
    moderationState: 'active',
    author: { label: 'Equipe do local', avatarUrl: null },
    text: 'Atualização do local.',
    image: { url: 'https://example.com/photo.webp', alt: 'Foto do local' },
    metrics: { commentCount: 0, reactionCount: 0 },
    publishedAt: new Date(),
  };
}

function authenticatedDb() {
  return testEnv.authenticatedContext('viewer').firestore();
}

describe('Firestore Rules / community_public_feed', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        host: '127.0.0.1',
        port: 8180,
        rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
      },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(
          context.firestore(),
          'community_public_feed',
          COMMUNITY_ID,
          'items',
          POST_ID
        ),
        postData()
      );
    });
  });

  afterAll(async () => testEnv.cleanup());

  it('nega documento pai, item e listagem ao cliente autenticado', async () => {
    const db = authenticatedDb();

    await assertFails(getDoc(doc(db, 'community_public_feed', COMMUNITY_ID)));
    await assertFails(
      getDoc(doc(db, 'community_public_feed', COMMUNITY_ID, 'items', POST_ID))
    );
    await assertFails(
      getDocs(collection(db, 'community_public_feed', COMMUNITY_ID, 'items'))
    );
  });

  it('nega criação direta ao cliente autenticado', async () => {
    await assertFails(
      setDoc(
        doc(
          authenticatedDb(),
          'community_public_feed',
          COMMUNITY_ID,
          'items',
          'post-2'
        ),
        postData()
      )
    );
  });

  it('nega atualização e exclusão direta', async () => {
    const itemRef = doc(
      authenticatedDb(),
      'community_public_feed',
      COMMUNITY_ID,
      'items',
      POST_ID
    );

    await assertFails(updateDoc(itemRef, { text: 'Alterado' }));
    await assertFails(deleteDoc(itemRef));
  });

  it('nega leitura sem autenticação', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      getDoc(doc(db, 'community_public_feed', COMMUNITY_ID, 'items', POST_ID))
    );
  });
});
