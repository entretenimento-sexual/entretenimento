// firestore-rules/tests/users-video-publications.rules.spec.ts
// -----------------------------------------------------------------------------
// FIRESTORE SECURITY RULES - PRIVATE VIDEO PUBLICATIONS
// -----------------------------------------------------------------------------
// Valida o contrato usado por VideoPublicationService:
// - dono pode ler e listar seu próprio estado de publicação;
// - terceiros e usuário deslogado não podem ler/listar;
// - cliente nunca pode criar, alterar ou excluir publicação diretamente;
// - listagem cobre a mesma ordenação usada pelo frontend.
// -----------------------------------------------------------------------------

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
  orderBy,
  query,
  setDoc,
  updateDoc,
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

const OWNER_UID = 'owner-video-publication';
const OUTSIDER_UID = 'outsider-video-publication';
const VIDEO_ID = 'video-publication-001';

let testEnv: RulesTestEnvironment;

function authenticatedDb(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}

async function seedPublication(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(
      doc(
        db,
        'users',
        OWNER_UID,
        'video_publications',
        VIDEO_ID
      ),
      {
        ownerUid: OWNER_UID,
        videoId: VIDEO_ID,
        isPublished: false,
        moderationStatus: 'PRIVATE',
        visibility: 'PRIVATE',
        updatedAt: new Date(),
      }
    );
  });
}

describe('Firestore Rules / users video publications', () => {
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
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('permite ao dono ler sua publicação privada', async () => {
    await seedPublication();

    const db = authenticatedDb(OWNER_UID);

    const snapshot = await assertSucceeds(
      getDoc(
        doc(
          db,
          'users',
          OWNER_UID,
          'video_publications',
          VIDEO_ID
        )
      )
    );

    expect(snapshot.exists()).toBe(true);
  });

  it('permite ao dono listar publicações por updatedAt desc', async () => {
    await seedPublication();

    const db = authenticatedDb(OWNER_UID);

    const publicationsQuery = query(
      collection(
        db,
        'users',
        OWNER_UID,
        'video_publications'
      ),
      orderBy('updatedAt', 'desc')
    );

    const snapshot = await assertSucceeds(
      getDocs(publicationsQuery)
    );

    expect(snapshot.size).toBe(1);
    expect(snapshot.docs[0]?.id).toBe(VIDEO_ID);
  });

  it('nega leitura individual para terceiro', async () => {
    await seedPublication();

    const db = authenticatedDb(OUTSIDER_UID);

    await assertFails(
      getDoc(
        doc(
          db,
          'users',
          OWNER_UID,
          'video_publications',
          VIDEO_ID
        )
      )
    );
  });

  it('nega listagem para terceiro', async () => {
    await seedPublication();

    const db = authenticatedDb(OUTSIDER_UID);

    await assertFails(
      getDocs(
        collection(
          db,
          'users',
          OWNER_UID,
          'video_publications'
        )
      )
    );
  });

  it('nega leitura sem autenticação', async () => {
    await seedPublication();

    const db = testEnv.unauthenticatedContext().firestore();

    await assertFails(
      getDoc(
        doc(
          db,
          'users',
          OWNER_UID,
          'video_publications',
          VIDEO_ID
        )
      )
    );
  });

  it('nega listagem sem autenticação', async () => {
    await seedPublication();

    const db = testEnv.unauthenticatedContext().firestore();

    await assertFails(
      getDocs(
        collection(
          db,
          'users',
          OWNER_UID,
          'video_publications'
        )
      )
    );
  });

  it('nega criação direta inclusive pelo dono', async () => {
    const db = authenticatedDb(OWNER_UID);

    await assertFails(
      setDoc(
        doc(
          db,
          'users',
          OWNER_UID,
          'video_publications',
          VIDEO_ID
        ),
        {
          ownerUid: OWNER_UID,
          videoId: VIDEO_ID,
          isPublished: true,
          updatedAt: new Date(),
        }
      )
    );
  });

  it('nega atualização direta inclusive pelo dono', async () => {
    await seedPublication();

    const db = authenticatedDb(OWNER_UID);

    await assertFails(
      updateDoc(
        doc(
          db,
          'users',
          OWNER_UID,
          'video_publications',
          VIDEO_ID
        ),
        {
          isPublished: true,
        }
      )
    );
  });

  it('nega exclusão direta inclusive pelo dono', async () => {
    await seedPublication();

    const db = authenticatedDb(OWNER_UID);

    await assertFails(
      deleteDoc(
        doc(
          db,
          'users',
          OWNER_UID,
          'video_publications',
          VIDEO_ID
        )
      )
    );
  });
});
