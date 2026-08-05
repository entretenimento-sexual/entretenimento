import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
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

  it('exige backend autorizado para metadados públicos de foto e vídeo', async () => {
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

  it('mantém acesso direto fechado quando o perfil pai foi ocultado', async () => {
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

  it('nega consultas globais diretas mesmo quando a mídia está privada', async () => {
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

    await assertFails(getDocs(videoQuery));
    await assertFails(getDocs(photoQuery));
  });

  it('continua negando consulta global após restauração para PUBLIC', async () => {
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

    await assertFails(getDocs(videoQuery));
    await assertFails(getDocs(photoQuery));
  });
});
