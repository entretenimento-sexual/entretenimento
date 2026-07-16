import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
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
const OWNER_UID = 'media-age-owner';
const VIEWER_UID = 'media-age-viewer';
const VIDEO_ID = 'age-video';
const PHOTO_ID = 'age-photo';

let testEnv: RulesTestEnvironment;

function viewerDb() {
  return testEnv.authenticatedContext(VIEWER_UID).firestore();
}

async function seedPublicMedia(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await Promise.all([
      setDoc(doc(db, 'public_profiles', OWNER_UID), {
        uid: OWNER_UID,
        nickname: 'Perfil adulto',
        nicknameNormalized: 'perfil-adulto',
        role: 'free',
      }),
      setDoc(
        doc(
          db,
          'public_profiles',
          OWNER_UID,
          'public_videos',
          VIDEO_ID
        ),
        {
          id: VIDEO_ID,
          ownerUid: OWNER_UID,
          visibility: 'PUBLIC',
          moderationStatus: 'APPROVED',
          score: 10,
          publishedAt: 1,
        }
      ),
      setDoc(
        doc(
          db,
          'public_profiles',
          OWNER_UID,
          'public_photos',
          PHOTO_ID
        ),
        {
          id: PHOTO_ID,
          ownerUid: OWNER_UID,
          visibility: 'PUBLIC',
          moderationStatus: 'APPROVED',
          publishedAt: 1,
        }
      ),
    ]);
  });
}

async function setMediaVisibility(visibility: 'PUBLIC' | 'PRIVATE') {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await Promise.all([
      updateDoc(
        doc(
          db,
          'public_profiles',
          OWNER_UID,
          'public_videos',
          VIDEO_ID
        ),
        { visibility }
      ),
      updateDoc(
        doc(
          db,
          'public_profiles',
          OWNER_UID,
          'public_photos',
          PHOTO_ID
        ),
        { visibility }
      ),
    ]);
  });
}

describe('Firestore Rules / public media age visibility', () => {
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
    await seedPublicMedia();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('permite mídia pública quando a projeção do perfil existe', async () => {
    const db = viewerDb();

    await assertSucceeds(
      getDoc(
        doc(
          db,
          'public_profiles',
          OWNER_UID,
          'public_videos',
          VIDEO_ID
        )
      )
    );
    await assertSucceeds(
      getDoc(
        doc(
          db,
          'public_profiles',
          OWNER_UID,
          'public_photos',
          PHOTO_ID
        )
      )
    );
  });

  it('bloqueia acesso direto quando o perfil pai foi ocultado', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(context.firestore(), 'public_profiles', OWNER_UID));
    });
    const db = viewerDb();

    await assertFails(
      getDoc(
        doc(
          db,
          'public_profiles',
          OWNER_UID,
          'public_videos',
          VIDEO_ID
        )
      )
    );
    await assertFails(
      getDoc(
        doc(
          db,
          'public_profiles',
          OWNER_UID,
          'public_photos',
          PHOTO_ID
        )
      )
    );
  });

  it('mantém consultas globais válidas e exclui projeções privadas', async () => {
    await setMediaVisibility('PRIVATE');
    const db = viewerDb();
    const videoQuery = query(
      collectionGroup(db, 'public_videos'),
      where('visibility', '==', 'PUBLIC'),
      where('moderationStatus', '==', 'APPROVED')
    );
    const photoQuery = query(
      collectionGroup(db, 'public_photos'),
      where('visibility', '==', 'PUBLIC'),
      where('moderationStatus', '==', 'APPROVED')
    );

    const [videos, photos] = await Promise.all([
      assertSucceeds(getDocs(videoQuery)),
      assertSucceeds(getDocs(photoQuery)),
    ]);

    expect(videos.empty).toBe(true);
    expect(photos.empty).toBe(true);
  });

  it('volta a incluir as projeções após restauração para PUBLIC', async () => {
    await setMediaVisibility('PRIVATE');
    await setMediaVisibility('PUBLIC');
    const db = viewerDb();
    const videoQuery = query(
      collectionGroup(db, 'public_videos'),
      where('visibility', '==', 'PUBLIC'),
      where('moderationStatus', '==', 'APPROVED')
    );
    const photoQuery = query(
      collectionGroup(db, 'public_photos'),
      where('visibility', '==', 'PUBLIC'),
      where('moderationStatus', '==', 'APPROVED')
    );

    const [videos, photos] = await Promise.all([
      assertSucceeds(getDocs(videoQuery)),
      assertSucceeds(getDocs(photoQuery)),
    ]);

    expect(videos.size).toBe(1);
    expect(photos.size).toBe(1);
  });
});
