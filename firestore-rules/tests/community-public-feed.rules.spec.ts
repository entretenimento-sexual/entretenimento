import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
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

function communityData(visibility: 'public_preview' | 'members_only' = 'public_preview') {
  return {
    status: 'active',
    moderation: { state: 'active' },
    visibility,
    access: { preview: 'authenticated' },
  };
}

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

function realtimeData() {
  return {
    postId: POST_ID,
    kind: 'photo',
    state: 'active',
    metrics: { commentCount: 0, reactionCount: 0 },
    publishedAt: Date.now() - 1_000,
    eventAt: Date.now(),
  };
}

function authenticatedDb(uid = 'viewer') {
  return testEnv.authenticatedContext(uid).firestore();
}

describe('Firestore Rules / community_public_feed + realtime', () => {
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
      await setDoc(doc(db, 'communities', COMMUNITY_ID), communityData());
      await setDoc(
        doc(db, 'community_public_feed', COMMUNITY_ID, 'items', POST_ID),
        postData()
      );
      await setDoc(
        doc(db, 'community_feed_realtime', COMMUNITY_ID, 'items', POST_ID),
        realtimeData()
      );
    });
  });

  afterAll(async () => testEnv.cleanup());

  it('mantém conteúdo integral do Mural inacessível ao cliente autenticado', async () => {
    const db = authenticatedDb();

    await assertFails(getDoc(doc(db, 'community_public_feed', COMMUNITY_ID)));
    await assertFails(
      getDoc(doc(db, 'community_public_feed', COMMUNITY_ID, 'items', POST_ID))
    );
    await assertFails(
      getDocs(collection(db, 'community_public_feed', COMMUNITY_ID, 'items'))
    );
  });

  it('permite ao autenticado ler/listar somente o stream mínimo de Comunidade com prévia', async () => {
    const db = authenticatedDb();
    await assertSucceeds(
      getDoc(doc(db, 'community_feed_realtime', COMMUNITY_ID, 'items', POST_ID))
    );
    await assertSucceeds(
      getDocs(collection(db, 'community_feed_realtime', COMMUNITY_ID, 'items'))
    );
  });

  it('Comunidade restrita exige membership ativa para o stream realtime', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'communities', COMMUNITY_ID), communityData('members_only'));
      await setDoc(
        doc(db, 'communities', COMMUNITY_ID, 'members', 'member'),
        { status: 'active', role: 'member' }
      );
    });

    await assertFails(
      getDoc(doc(
        authenticatedDb('outsider'),
        'community_feed_realtime',
        COMMUNITY_ID,
        'items',
        POST_ID
      ))
    );
    await assertSucceeds(
      getDoc(doc(
        authenticatedDb('member'),
        'community_feed_realtime',
        COMMUNITY_ID,
        'items',
        POST_ID
      ))
    );
  });

  it('membership bloqueada nega realtime inclusive em Comunidade com prévia', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'communities', COMMUNITY_ID, 'members', 'blocked'),
        { status: 'blocked', role: 'member' }
      );
    });

    await assertFails(
      getDoc(doc(
        authenticatedDb('blocked'),
        'community_feed_realtime',
        COMMUNITY_ID,
        'items',
        POST_ID
      ))
    );
  });

  it('nega qualquer escrita direta no conteúdo e no stream realtime', async () => {
    const db = authenticatedDb();
    await assertFails(
      setDoc(
        doc(db, 'community_public_feed', COMMUNITY_ID, 'items', 'post-2'),
        postData()
      )
    );

    const realtimeRef = doc(
      db,
      'community_feed_realtime',
      COMMUNITY_ID,
      'items',
      POST_ID
    );
    await assertFails(updateDoc(realtimeRef, { eventAt: Date.now() + 1 }));
    await assertFails(deleteDoc(realtimeRef));
    await assertFails(
      setDoc(
        doc(db, 'community_feed_realtime', COMMUNITY_ID, 'items', 'post-2'),
        { ...realtimeData(), postId: 'post-2' }
      )
    );
  });

  it('nega estado operacional, respostas, idempotência, rate limit e auditoria', async () => {
    const db = authenticatedDb();
    const protectedReferences = [
      doc(db, 'community_feed_posts', COMMUNITY_ID, 'items', POST_ID),
      doc(
        db,
        'community_feed_posts',
        COMMUNITY_ID,
        'items',
        POST_ID,
        'reactions',
        'viewer'
      ),
      doc(
        db,
        'community_feed_posts',
        COMMUNITY_ID,
        'items',
        POST_ID,
        'comments',
        'comment-1'
      ),
      doc(
        db,
        'community_feed_posts',
        COMMUNITY_ID,
        'items',
        POST_ID,
        'comments',
        'comment-1',
        'replies',
        'reply-1'
      ),
      doc(db, 'community_feed_requests', 'request-1'),
      doc(db, 'community_feed_user_state', 'viewer'),
      doc(
        db,
        'community_feed_user_posts',
        'viewer',
        'items',
        `${COMMUNITY_ID}:${POST_ID}`
      ),
      doc(
        db,
        'community_feed_user_actions',
        'viewer',
        'items',
        `${COMMUNITY_ID}:${POST_ID}`
      ),
      doc(
        db,
        'community_feed_user_reactions',
        'viewer',
        'items',
        `${COMMUNITY_ID}:${POST_ID}`
      ),
      doc(
        db,
        'community_feed_user_comments',
        'viewer',
        'items',
        `${COMMUNITY_ID}:${POST_ID}:comment-1`
      ),
      doc(
        db,
        'community_feed_user_replies',
        'viewer',
        'items',
        `${COMMUNITY_ID}:${POST_ID}:comment-1:reply-1`
      ),
      doc(db, 'community_feed_audit', 'audit-1'),
    ];

    for (const reference of protectedReferences) {
      await assertFails(getDoc(reference));
      await assertFails(setDoc(reference, { actorUid: 'viewer' }));
    }
  });

  it('nega atualização e exclusão direta da projeção integral', async () => {
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

  it('nega realtime e conteúdo integral sem autenticação', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      getDoc(doc(db, 'community_public_feed', COMMUNITY_ID, 'items', POST_ID))
    );
    await assertFails(
      getDoc(doc(db, 'community_feed_realtime', COMMUNITY_ID, 'items', POST_ID))
    );
  });
});
