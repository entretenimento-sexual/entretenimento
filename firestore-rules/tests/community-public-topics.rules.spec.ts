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
const COMMUNITY_ID = 'community-topics';
const TOPIC_ID = 'topic-1';
const REPLY_ID = 'reply-1';
let testEnv: RulesTestEnvironment;

function topicData() {
  const createdAt = new Date();

  return {
    audience: 'public_preview',
    status: 'active',
    moderationState: 'active',
    title: 'Tema de conversa',
    excerpt: 'Resumo sanitizado do tópico.',
    author: { label: 'Pessoa da Comunidade', avatarUrl: null },
    metrics: { replyCount: 1, reactionCount: 0 },
    createdAt,
    lastActivityAt: createdAt,
  };
}

function authenticatedDb() {
  return testEnv.authenticatedContext('viewer').firestore();
}

describe('Firestore Rules / community_public_topics', () => {
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
      const db = context.firestore();
      await setDoc(
        doc(db, 'community_public_topics', COMMUNITY_ID, 'items', TOPIC_ID),
        topicData()
      );
      await setDoc(
        doc(
          db,
          'community_public_topics',
          COMMUNITY_ID,
          'items',
          TOPIC_ID,
          'replies',
          REPLY_ID
        ),
        {
          body: 'Resposta sanitizada.',
          author: { label: 'Pessoa da Comunidade', avatarUrl: null },
          moderationState: 'active',
          createdAt: new Date(),
        }
      );
    });
  });

  afterAll(async () => testEnv.cleanup());

  it('nega documento pai, tópico e listagem ao cliente autenticado', async () => {
    const db = authenticatedDb();

    await assertFails(getDoc(doc(db, 'community_public_topics', COMMUNITY_ID)));
    await assertFails(
      getDoc(
        doc(db, 'community_public_topics', COMMUNITY_ID, 'items', TOPIC_ID)
      )
    );
    await assertFails(
      getDocs(collection(db, 'community_public_topics', COMMUNITY_ID, 'items'))
    );
  });

  it('nega leitura e listagem direta da projeção de respostas', async () => {
    const db = authenticatedDb();
    const replies = collection(
      db,
      'community_public_topics',
      COMMUNITY_ID,
      'items',
      TOPIC_ID,
      'replies'
    );

    await assertFails(getDoc(doc(replies, REPLY_ID)));
    await assertFails(getDocs(replies));
  });

  it('nega criação direta ao cliente autenticado', async () => {
    await assertFails(
      setDoc(
        doc(
          authenticatedDb(),
          'community_public_topics',
          COMMUNITY_ID,
          'items',
          'topic-2'
        ),
        topicData()
      )
    );
  });

  it('nega atualização e exclusão direta', async () => {
    const topicRef = doc(
      authenticatedDb(),
      'community_public_topics',
      COMMUNITY_ID,
      'items',
      TOPIC_ID
    );

    await assertFails(updateDoc(topicRef, { title: 'Alterado' }));
    await assertFails(deleteDoc(topicRef));
  });

  it('nega leitura sem autenticação', async () => {
    const db = testEnv.unauthenticatedContext().firestore();

    await assertFails(
      getDoc(
        doc(db, 'community_public_topics', COMMUNITY_ID, 'items', TOPIC_ID)
      )
    );
  });
});
