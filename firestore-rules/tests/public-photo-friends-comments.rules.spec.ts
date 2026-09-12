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

const PROJECT_ID = 'demo-photo-friends-comments-rules';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8180;
const OWNER_UID = 'photo-owner';
const VIEWER_UID = 'photo-viewer';
const PHOTO_ID = 'friends-photo';
const COMMENT_ID = 'visible-comment';

let testEnv: RulesTestEnvironment;

function viewerDb() {
  return testEnv.authenticatedContext(VIEWER_UID).firestore();
}

function commentRef(db: ReturnType<typeof viewerDb>) {
  return doc(
    db,
    'public_profiles',
    OWNER_UID,
    'public_photos',
    PHOTO_ID,
    'comments',
    COMMENT_ID
  );
}

async function seedBase(visibility: 'PUBLIC' | 'FRIENDS' = 'FRIENDS') {
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
      setDoc(doc(db, 'users', OWNER_UID), {
        uid: OWNER_UID,
        accountStatus: 'active',
      }),
      setDoc(doc(db, 'public_profiles', OWNER_UID), {
        uid: OWNER_UID,
        nickname: 'Owner',
      }),
      setDoc(
        doc(db, 'public_profiles', OWNER_UID, 'public_photos', PHOTO_ID),
        {
          id: PHOTO_ID,
          ownerUid: OWNER_UID,
          visibility,
          moderationStatus: 'APPROVED',
          publishedAt: 1,
        }
      ),
      setDoc(
        doc(
          db,
          'public_profiles',
          OWNER_UID,
          'public_photos',
          PHOTO_ID,
          'comments',
          COMMENT_ID
        ),
        {
          id: COMMENT_ID,
          ownerUid: OWNER_UID,
          photoId: PHOTO_ID,
          authorUid: OWNER_UID,
          authorNickname: 'Owner',
          content: 'Comentário',
          status: 'VISIBLE',
          parentCommentId: null,
          isOwnerReply: false,
          createdAt: 1,
        }
      ),
    ]);
  });
}

async function setFriendEdges(options: {
  viewerToOwner: boolean;
  ownerToViewer: boolean;
}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const writes: Promise<unknown>[] = [];

    if (options.viewerToOwner) {
      writes.push(setDoc(
        doc(db, 'users', VIEWER_UID, 'friends', OWNER_UID),
        { uid: OWNER_UID, createdAt: 1 }
      ));
    }

    if (options.ownerToViewer) {
      writes.push(setDoc(
        doc(db, 'users', OWNER_UID, 'friends', VIEWER_UID),
        { uid: VIEWER_UID, createdAt: 1 }
      ));
    }

    await Promise.all(writes);
  });
}

async function setBlock(blockerUid: string, targetUid: string) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), 'users', blockerUid, 'blocks', targetUid),
      { isBlocked: true, updatedAt: 1 }
    );
  });
}

describe('Firestore Rules / FRIENDS photo comments', () => {
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
    await seedBase();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('nega comentário FRIENDS sem amizade bilateral', async () => {
    await assertFails(getDoc(commentRef(viewerDb())));
  });

  it('não aceita aresta unilateral como autoridade de amizade', async () => {
    await setFriendEdges({ viewerToOwner: true, ownerToViewer: false });
    await assertFails(getDoc(commentRef(viewerDb())));

    await testEnv.clearFirestore();
    await seedBase();
    await setFriendEdges({ viewerToOwner: false, ownerToViewer: true });
    await assertFails(getDoc(commentRef(viewerDb())));
  });

  it('permite get e list de comentário FRIENDS com amizade bilateral', async () => {
    await setFriendEdges({ viewerToOwner: true, ownerToViewer: true });
    const db = viewerDb();

    await assertSucceeds(getDoc(commentRef(db)));

    const comments = await assertSucceeds(getDocs(query(
      collection(
        db,
        'public_profiles',
        OWNER_UID,
        'public_photos',
        PHOTO_ID,
        'comments'
      ),
      where('status', '==', 'VISIBLE')
    )));

    expect(comments.size).toBe(1);
  });

  it('bloqueio em qualquer direção revoga leitura mesmo entre amigos', async () => {
    await setFriendEdges({ viewerToOwner: true, ownerToViewer: true });
    await setBlock(VIEWER_UID, OWNER_UID);
    await assertFails(getDoc(commentRef(viewerDb())));

    await testEnv.clearFirestore();
    await seedBase();
    await setFriendEdges({ viewerToOwner: true, ownerToViewer: true });
    await setBlock(OWNER_UID, VIEWER_UID);
    await assertFails(getDoc(commentRef(viewerDb())));
  });

  it('mantém projeção FRIENDS fora da leitura direta e da descoberta pública', async () => {
    await setFriendEdges({ viewerToOwner: true, ownerToViewer: true });
    const db = viewerDb();

    await assertFails(getDoc(
      doc(db, 'public_profiles', OWNER_UID, 'public_photos', PHOTO_ID)
    ));
  });

  it('preserva comentários PUBLIC visíveis sem exigir amizade', async () => {
    await testEnv.clearFirestore();
    await seedBase('PUBLIC');

    await assertSucceeds(getDoc(commentRef(viewerDb())));
  });
});
