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
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

const PROJECT_ID = 'demo-entretenimento-rules';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8180;

const OWNER_UID = 'video-owner';
const VIEWER_UID = 'video-viewer';
const VIDEO_ID = 'public-video-001';

let testEnv: RulesTestEnvironment;

function authenticatedDb(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}

async function seedPublicVideo(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, 'public_profiles', OWNER_UID), {
      uid: OWNER_UID,
      nickname: 'Perfil do vídeo',
    });
    await setDoc(
      doc(db, 'public_profiles', OWNER_UID, 'public_videos', VIDEO_ID),
      {
        id: VIDEO_ID,
        ownerUid: OWNER_UID,
        mediaType: 'VIDEO',
        visibility: 'PUBLIC',
        moderationStatus: 'APPROVED',
        assetAccess: 'SIGNED_URL',
        publishedAt: Date.now(),
      }
    );
    await setDoc(
      doc(
        db,
        'public_profiles',
        OWNER_UID,
        'public_videos',
        VIDEO_ID,
        'comments',
        'comment-001'
      ),
      {
        id: 'comment-001',
        ownerUid: OWNER_UID,
        status: 'VISIBLE',
        text: 'Comentário público',
      }
    );
  });
}

async function seedBlock(
  blockerUid: string,
  targetUid: string,
  isBlocked = true
): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(
      doc(db, 'users', blockerUid, 'blocks', targetUid),
      {
        uid: targetUid,
        actorUid: blockerUid,
        isBlocked,
        updatedAt: Date.now(),
      }
    );
  });
}

describe('Firestore Rules / public profile videos audience', () => {
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
    await seedPublicVideo();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('nega metadados diretos ao visitante e preserva leitura do proprietário', async () => {
    const viewerDb = authenticatedDb(VIEWER_UID);
    const ownerDb = authenticatedDb(OWNER_UID);

    await assertFails(
      getDoc(
        doc(
          viewerDb,
          'public_profiles',
          OWNER_UID,
          'public_videos',
          VIDEO_ID
        )
      )
    );

    const ownerVideo = await assertSucceeds(
      getDoc(
        doc(
          ownerDb,
          'public_profiles',
          OWNER_UID,
          'public_videos',
          VIDEO_ID
        )
      )
    );
    expect(ownerVideo.exists()).toBe(true);
  });

  it('nega listagem direta por perfil ao visitante', async () => {
    const db = authenticatedDb(VIEWER_UID);

    await assertFails(
      getDocs(query(
        collection(db, 'public_profiles', OWNER_UID, 'public_videos'),
        where('visibility', '==', 'PUBLIC'),
        where('moderationStatus', '==', 'APPROVED')
      ))
    );
  });

  it('preserva comentários visíveis sem bloqueio durante a transição', async () => {
    const db = authenticatedDb(VIEWER_UID);

    const comment = await assertSucceeds(
      getDoc(doc(
        db,
        'public_profiles',
        OWNER_UID,
        'public_videos',
        VIDEO_ID,
        'comments',
        'comment-001'
      ))
    );
    expect(comment.exists()).toBe(true);
  });

  it('nega comentários quando o visitante bloqueou o autor', async () => {
    await seedBlock(VIEWER_UID, OWNER_UID);
    const db = authenticatedDb(VIEWER_UID);

    await assertFails(
      getDoc(doc(
        db,
        'public_profiles',
        OWNER_UID,
        'public_videos',
        VIDEO_ID,
        'comments',
        'comment-001'
      ))
    );
  });

  it('nega comentários quando o autor bloqueou o visitante', async () => {
    await seedBlock(OWNER_UID, VIEWER_UID);
    const db = authenticatedDb(VIEWER_UID);

    await assertFails(
      getDoc(doc(
        db,
        'public_profiles',
        OWNER_UID,
        'public_videos',
        VIDEO_ID,
        'comments',
        'comment-001'
      ))
    );
  });

  it('não trata histórico de bloqueio inativo como bloqueio atual', async () => {
    await seedBlock(OWNER_UID, VIEWER_UID, false);
    const db = authenticatedDb(VIEWER_UID);

    await assertSucceeds(
      getDoc(doc(
        db,
        'public_profiles',
        OWNER_UID,
        'public_videos',
        VIDEO_ID,
        'comments',
        'comment-001'
      ))
    );
  });

  it('nega consulta global direta para exigir feed autorizado no backend', async () => {
    const db = authenticatedDb(VIEWER_UID);

    await assertFails(
      getDocs(query(
        collectionGroup(db, 'public_videos'),
        where('visibility', '==', 'PUBLIC'),
        where('moderationStatus', '==', 'APPROVED')
      ))
    );
  });

  it('nega leitura sem autenticação', async () => {
    const db = testEnv.unauthenticatedContext().firestore();

    await assertFails(
      getDoc(
        doc(db, 'public_profiles', OWNER_UID, 'public_videos', VIDEO_ID)
      )
    );
  });
});
