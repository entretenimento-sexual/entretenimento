// firestore-rules/tests/users-videos.rules.spec.ts
// -----------------------------------------------------------------------------
// FIRESTORE SECURITY RULES - PRIVATE USER VIDEOS
// -----------------------------------------------------------------------------
//
// Escopo validado nesta suíte:
// - leitura/listagem somente pelo dono;
// - bloqueio para terceiros e usuário deslogado;
// - criação, atualização e exclusão diretas negadas inclusive ao dono;
// - metadados operacionais são autoridade exclusiva do backend.

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
  serverTimestamp,
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

const OWNER_UID = 'owner-video-user';
const OUTSIDER_UID = 'outsider-video-user';
const VIDEO_ID = 'video-001';

let testEnv: RulesTestEnvironment;

function authenticatedDb(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}

function validVideoPayload(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: VIDEO_ID,
    ownerUid: OWNER_UID,
    url: 'https://storage.googleapis.com/demo/video-001.mp4',
    path: `users/${OWNER_UID}/videos/video-001.mp4`,
    fileName: 'video-001.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 1024,
    durationMs: 12000,
    thumbnailUrl: null,
    status: 'uploaded',
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

async function seedVideo(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, 'users', OWNER_UID, 'videos', VIDEO_ID), {
      id: VIDEO_ID,
      ownerUid: OWNER_UID,
      url: 'https://storage.googleapis.com/demo/video-001.mp4',
      path: `users/${OWNER_UID}/videos/video-001.mp4`,
      fileName: 'video-001.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 1024,
      durationMs: 12000,
      thumbnailUrl: null,
      status: 'uploaded',
      createdAt: new Date(),
      updatedAt: null,
    });
  });
}

describe('Firestore Rules / users videos', () => {
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

  it('nega ao dono criar metadados de vídeo diretamente', async () => {
    const db = authenticatedDb(OWNER_UID);

    await assertFails(
      setDoc(
        doc(db, 'users', OWNER_UID, 'videos', VIDEO_ID),
        validVideoPayload()
      )
    );
  });

  it('permite ao dono ler diretamente seu próprio vídeo', async () => {
    await seedVideo();

    const db = authenticatedDb(OWNER_UID);

    const snapshot = await assertSucceeds(
      getDoc(doc(db, 'users', OWNER_UID, 'videos', VIDEO_ID))
    );

    expect(snapshot.exists()).toBe(true);
  });

  it('permite ao dono listar sua biblioteca privada de vídeos', async () => {
    await seedVideo();

    const db = authenticatedDb(OWNER_UID);

    const snapshot = await assertSucceeds(
      getDocs(collection(db, 'users', OWNER_UID, 'videos'))
    );

    expect(snapshot.size).toBe(1);
  });

  it('nega leitura para usuário terceiro', async () => {
    await seedVideo();

    const db = authenticatedDb(OUTSIDER_UID);

    await assertFails(
      getDoc(doc(db, 'users', OWNER_UID, 'videos', VIDEO_ID))
    );
  });

  it('nega listagem para usuário terceiro', async () => {
    await seedVideo();

    const db = authenticatedDb(OUTSIDER_UID);

    await assertFails(
      getDocs(collection(db, 'users', OWNER_UID, 'videos'))
    );
  });

  it('nega leitura sem autenticação', async () => {
    await seedVideo();

    const db = testEnv.unauthenticatedContext().firestore();

    await assertFails(
      getDoc(doc(db, 'users', OWNER_UID, 'videos', VIDEO_ID))
    );
  });

  it('nega criação por usuário terceiro em biblioteca alheia', async () => {
    const db = authenticatedDb(OUTSIDER_UID);

    await assertFails(
      setDoc(
        doc(db, 'users', OWNER_UID, 'videos', VIDEO_ID),
        validVideoPayload()
      )
    );
  });

  it('nega criação quando id do documento diverge do payload', async () => {
    const db = authenticatedDb(OWNER_UID);

    await assertFails(
      setDoc(
        doc(db, 'users', OWNER_UID, 'videos', VIDEO_ID),
        validVideoPayload({ id: 'video-divergente' })
      )
    );
  });

  it('nega criação com ownerUid divergente', async () => {
    const db = authenticatedDb(OWNER_UID);

    await assertFails(
      setDoc(
        doc(db, 'users', OWNER_UID, 'videos', VIDEO_ID),
        validVideoPayload({ ownerUid: OUTSIDER_UID })
      )
    );
  });

  it('nega criação com MIME type não permitido', async () => {
    const db = authenticatedDb(OWNER_UID);

    await assertFails(
      setDoc(
        doc(db, 'users', OWNER_UID, 'videos', VIDEO_ID),
        validVideoPayload({ mimeType: 'application/octet-stream' })
      )
    );
  });

  it('nega criação com createdAt controlado pelo cliente', async () => {
    const db = authenticatedDb(OWNER_UID);

    await assertFails(
      setDoc(
        doc(db, 'users', OWNER_UID, 'videos', VIDEO_ID),
        validVideoPayload({ createdAt: Date.now() })
      )
    );
  });

  it('nega ao dono atualizar campos operacionais diretamente', async () => {
    await seedVideo();

    const db = authenticatedDb(OWNER_UID);

    await assertFails(
      updateDoc(doc(db, 'users', OWNER_UID, 'videos', VIDEO_ID), {
        status: 'ready',
        durationMs: 13000,
        thumbnailUrl: 'https://storage.googleapis.com/demo/thumb-001.jpg',
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('nega update tentando alterar url do vídeo', async () => {
    await seedVideo();

    const db = authenticatedDb(OWNER_UID);

    await assertFails(
      updateDoc(doc(db, 'users', OWNER_UID, 'videos', VIDEO_ID), {
        url: 'https://example.invalid/video.mp4',
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('nega update tentando alterar path do vídeo', async () => {
    await seedVideo();

    const db = authenticatedDb(OWNER_UID);

    await assertFails(
      updateDoc(doc(db, 'users', OWNER_UID, 'videos', VIDEO_ID), {
        path: `users/${OUTSIDER_UID}/videos/video-001.mp4`,
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('nega update sem updatedAt por serverTimestamp', async () => {
    await seedVideo();

    const db = authenticatedDb(OWNER_UID);

    await assertFails(
      updateDoc(doc(db, 'users', OWNER_UID, 'videos', VIDEO_ID), {
        status: 'ready',
      })
    );
  });
});
