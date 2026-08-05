import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDoc,
  setDoc,
} from 'firebase/firestore';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  it,
} from 'vitest';

const PROJECT_ID = 'demo-media-account-lifecycle-rules';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8180;
const ACTIVE_UID = 'media-active-user';
const SUSPENDED_UID = 'media-suspended-user';
const PHOTO_ID = 'private-photo';
const VIDEO_ID = 'private-video';

let testEnv: RulesTestEnvironment;

function userContext(uid: string) {
  return testEnv.authenticatedContext(uid, {
    email_verified: true,
  }).firestore();
}

function operationalUser(uid: string, accountStatus = 'active') {
  return {
    uid,
    accountStatus,
    suspended: accountStatus !== 'active',
    interactionBlocked: accountStatus !== 'active',
    accountLocked: false,
    loginAllowed: true,
    emailVerified: true,
    profileCompleted: true,
    initialAdultConsentRequired: true,
    adultConsent: { accepted: true },
    acceptedTerms: {
      accepted: true,
      adultAccessAcknowledgement: true,
    },
    ageReverification: { status: 'VERIFIED', result: 'ADULT' },
  };
}

async function seedPrivateMedia(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    for (const [uid, status] of [
      [ACTIVE_UID, 'active'],
      [SUSPENDED_UID, 'moderation_suspended'],
    ] as const) {
      await Promise.all([
        setDoc(doc(db, 'users', uid), operationalUser(uid, status)),
        setDoc(doc(db, 'users', uid, 'photos', PHOTO_ID), {
          id: PHOTO_ID,
          path: `users/${uid}/uploads/images/photo.jpg`,
          fileName: 'photo.jpg',
          createdAt: 1,
        }),
        setDoc(doc(db, 'users', uid, 'videos', VIDEO_ID), {
          id: VIDEO_ID,
          ownerUid: uid,
          status: 'ready',
        }),
      ]);
    }
  });
}

describe('Firestore Rules / media account lifecycle', () => {
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
    await seedPrivateMedia();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('permite biblioteca privada apenas para conta operacional', async () => {
    const activeDb = userContext(ACTIVE_UID);
    const suspendedDb = userContext(SUSPENDED_UID);

    await assertSucceeds(
      getDoc(doc(activeDb, 'users', ACTIVE_UID, 'photos', PHOTO_ID))
    );
    await assertSucceeds(
      getDoc(doc(activeDb, 'users', ACTIVE_UID, 'videos', VIDEO_ID))
    );
    await assertFails(
      getDoc(doc(suspendedDb, 'users', SUSPENDED_UID, 'photos', PHOTO_ID))
    );
    await assertFails(
      getDoc(doc(suspendedDb, 'users', SUSPENDED_UID, 'videos', VIDEO_ID))
    );
  });

  it('nega criação de foto durante suspensão', async () => {
    const suspendedDb = userContext(SUSPENDED_UID);

    await assertFails(
      setDoc(doc(suspendedDb, 'users', SUSPENDED_UID, 'photos', 'new-photo'), {
        id: 'new-photo',
        path: `users/${SUSPENDED_UID}/uploads/images/new.jpg`,
        fileName: 'new.jpg',
        createdAt: 2,
      })
    );
  });

  it('mantém exclusão da própria foto disponível durante suspensão', async () => {
    const suspendedDb = userContext(SUSPENDED_UID);

    await assertSucceeds(
      deleteDoc(
        doc(suspendedDb, 'users', SUSPENDED_UID, 'photos', PHOTO_ID)
      )
    );
  });
});
