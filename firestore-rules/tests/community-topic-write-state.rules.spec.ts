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
  updateDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const PROJECT_ID = 'demo-entretenimento-rules';
const COMMUNITY_ID = 'community-topic-write';
const TOPIC_ID = 'topic-1';
const REPLY_ID = 'reply-1';
let testEnv: RulesTestEnvironment;

function authenticatedDb() {
  return testEnv.authenticatedContext('viewer').firestore();
}

describe('Firestore Rules / community topic write state', () => {
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
        doc(db, 'community_topics', COMMUNITY_ID, 'items', TOPIC_ID),
        { actorUid: 'viewer', body: 'Texto interno', status: 'active' }
      );
      await setDoc(
        doc(
          db,
          'community_topics',
          COMMUNITY_ID,
          'items',
          TOPIC_ID,
          'replies',
          REPLY_ID
        ),
        { actorUid: 'viewer', body: 'Resposta interna' }
      );
      await setDoc(doc(db, 'community_topic_requests', 'request-1'), {
        actorUid: 'viewer',
        kind: 'topic',
      });
      await setDoc(doc(db, 'community_topic_user_state', 'viewer'), {
        topicWritesInWindow: 1,
      });
      await setDoc(doc(db, 'community_topic_audit', 'audit-1'), {
        actorUid: 'viewer',
      });
    });
  });

  afterAll(async () => testEnv.cleanup());

  it('nega leitura do tópico operacional e de suas respostas', async () => {
    const db = authenticatedDb();
    await assertFails(
      getDoc(doc(db, 'community_topics', COMMUNITY_ID, 'items', TOPIC_ID))
    );
    await assertFails(
      getDocs(collection(db, 'community_topics', COMMUNITY_ID, 'items'))
    );
    await assertFails(
      getDoc(
        doc(
          db,
          'community_topics',
          COMMUNITY_ID,
          'items',
          TOPIC_ID,
          'replies',
          REPLY_ID
        )
      )
    );
  });

  it('nega escrita direta no estado operacional', async () => {
    const topicRef = doc(
      authenticatedDb(),
      'community_topics',
      COMMUNITY_ID,
      'items',
      TOPIC_ID
    );
    await assertFails(updateDoc(topicRef, { body: 'Alterado pelo cliente' }));
    await assertFails(
      setDoc(
        doc(
          authenticatedDb(),
          'community_topics',
          COMMUNITY_ID,
          'items',
          'topic-2'
        ),
        { actorUid: 'viewer', body: 'Novo tópico' }
      )
    );
  });

  it('nega leitura e escrita de idempotência e rate limit', async () => {
    const db = authenticatedDb();
    await assertFails(getDoc(doc(db, 'community_topic_requests', 'request-1')));
    await assertFails(getDoc(doc(db, 'community_topic_user_state', 'viewer')));
    await assertFails(
      setDoc(doc(db, 'community_topic_requests', 'request-2'), {
        actorUid: 'viewer',
      })
    );
    await assertFails(
      updateDoc(doc(db, 'community_topic_user_state', 'viewer'), {
        topicWritesInWindow: 0,
      })
    );
  });

  it('nega leitura e escrita da auditoria ao cliente', async () => {
    const db = authenticatedDb();
    await assertFails(getDoc(doc(db, 'community_topic_audit', 'audit-1')));
    await assertFails(
      setDoc(doc(db, 'community_topic_audit', 'audit-2'), {
        actorUid: 'viewer',
      })
    );
  });

  it('nega acesso ao estado interno sem autenticação', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      getDoc(doc(db, 'community_topics', COMMUNITY_ID, 'items', TOPIC_ID))
    );
    await assertFails(getDoc(doc(db, 'community_topic_user_state', 'viewer')));
  });
});
