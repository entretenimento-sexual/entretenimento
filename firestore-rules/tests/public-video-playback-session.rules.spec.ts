import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  it,
} from 'vitest';

const PROJECT_ID = 'demo-public-video-playback-session-rules';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8180;
const OWNER_UID = 'playback-owner';
const VIEWER_UID = 'playback-viewer';
const VIDEO_ID = 'playback-video';

let testEnv: RulesTestEnvironment;

function playbackSessionRef(db: Firestore) {
  return doc(
    db,
    'public_profiles',
    OWNER_UID,
    'public_videos',
    VIDEO_ID,
    'playback_sessions',
    VIEWER_UID
  );
}

describe('Firestore Rules / public video playback sessions', () => {
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

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();

      await Promise.all([
        setDoc(doc(db, 'users', VIEWER_UID), {
          uid: VIEWER_UID,
          accountStatus: 'active',
          suspended: false,
          acceptedTerms: {
            accepted: true,
            version: 'v3',
            acknowledgedPrivacyNotice: true,
          },
          initialAdultConsentRequired: false,
          ageReverification: { status: 'NONE' },
        }),
        setDoc(doc(db, 'public_profiles', OWNER_UID), {
          uid: OWNER_UID,
          nickname: 'Perfil playback',
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
          }
        ),
      ]);

      await setDoc(playbackSessionRef(db), {
        viewerUid: VIEWER_UID,
        ownerUid: OWNER_UID,
        videoId: VIDEO_ID,
        tokenHash: 'server-only',
      });
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('nega leitura da sessão mesmo para viewer elegível', async () => {
    const db = testEnv.authenticatedContext(VIEWER_UID).firestore();

    await assertFails(getDoc(playbackSessionRef(db)));
  });

  it('nega criação, alteração e exclusão pelo cliente', async () => {
    const db = testEnv.authenticatedContext(VIEWER_UID).firestore();
    const ref = playbackSessionRef(db);

    await assertFails(setDoc(ref, { tokenHash: 'forged' }));
    await assertFails(updateDoc(ref, { tokenHash: 'forged' }));
    await assertFails(deleteDoc(ref));
  });
});
