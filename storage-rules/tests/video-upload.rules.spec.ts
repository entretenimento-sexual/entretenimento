import { readFileSync } from 'node:fs';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import {
  deleteObject,
  getBytes,
  ref,
  uploadBytes,
  type FirebaseStorage,
} from 'firebase/storage';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  it,
} from 'vitest';

const PROJECT_ID = 'demo-entretenimento-storage-rules';
const BUCKET_URL = `gs://${PROJECT_ID}.appspot.com`;
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8188;
const STORAGE_HOST = '127.0.0.1';
const STORAGE_PORT = 9299;
const SMALL_VIDEO = new Uint8Array([0, 1, 2, 3]);
const SMALL_IMAGE = new Uint8Array([4, 5, 6, 7]);

let testEnvironment: RulesTestEnvironment;

function authenticatedStorage(uid: string): FirebaseStorage {
  return testEnvironment.authenticatedContext(uid).storage(BUCKET_URL);
}

function unauthenticatedStorage(): FirebaseStorage {
  return testEnvironment.unauthenticatedContext().storage(BUCKET_URL);
}

function uploadVideo(input: {
  storage: FirebaseStorage;
  ownerUid: string;
  fileName: string;
  contentType: string;
}) {
  return uploadBytes(
    ref(
      input.storage,
      `users/${input.ownerUid}/uploads/videos/${input.fileName}`
    ),
    SMALL_VIDEO,
    { contentType: input.contentType }
  );
}

function uploadPhoto(input: {
  storage: FirebaseStorage;
  ownerUid: string;
  photoId?: string;
  slot?: string;
  contentType?: string;
}) {
  const photoId = input.photoId ?? 'photo-1';
  const slot = input.slot ?? 'source-a';

  return uploadBytes(
    ref(
      input.storage,
      `users/${input.ownerUid}/uploads/images/${photoId}/${slot}`
    ),
    SMALL_IMAGE,
    { contentType: input.contentType ?? 'image/jpeg' }
  );
}

async function seedRegisteredPhoto(
  ownerUid: string,
  photoId = 'photo-1'
): Promise<void> {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), `users/${ownerUid}/photos/${photoId}`),
      {
        id: photoId,
        path: `users/${ownerUid}/uploads/images/${photoId}/source-a`,
      }
    );
  });
}

beforeAll(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: FIRESTORE_HOST,
      port: FIRESTORE_PORT,
      rules: readFileSync('firestore.storage-rules-test.rules', 'utf8'),
    },
    storage: {
      host: STORAGE_HOST,
      port: STORAGE_PORT,
      rules: readFileSync('storage.rules', 'utf8'),
    },
  });
});

beforeEach(async () => {
  await Promise.all([
    testEnvironment.clearFirestore(),
    testEnvironment.clearStorage(),
  ]);
});

afterAll(async () => {
  await testEnvironment.cleanup();
});

describe('Storage Rules — uploads privados de vídeo', () => {
  it.each([
    ['MP4', 'clip.mp4', 'video/mp4'],
    ['M4V', 'clip.m4v', 'video/mp4'],
    ['MOV', 'clip.mov', 'video/quicktime'],
    ['WebM', 'clip.webm', 'video/webm'],
  ])('permite %s processável ao proprietário', async (_label, fileName, contentType) => {
    await assertSucceeds(
      uploadVideo({
        storage: authenticatedStorage('alice'),
        ownerUid: 'alice',
        fileName,
        contentType,
      })
    );
  });

  it.each([
    ['MKV', 'clip.mkv', 'video/x-matroska'],
    ['AVI', 'clip.avi', 'video/x-msvideo'],
    ['WMV', 'clip.wmv', 'video/x-ms-wmv'],
    ['TS', 'clip.ts', 'video/mp2t'],
    ['MXF', 'clip.mxf', 'application/mxf'],
    ['OGG', 'clip.ogv', 'video/ogg'],
    ['binário genérico', 'clip.bin', 'application/octet-stream'],
  ])('bloqueia %s não processável', async (_label, fileName, contentType) => {
    await assertFails(
      uploadVideo({
        storage: authenticatedStorage('alice'),
        ownerUid: 'alice',
        fileName,
        contentType,
      })
    );
  });

  it('bloqueia upload no namespace de outro usuário', async () => {
    await assertFails(
      uploadVideo({
        storage: authenticatedStorage('bob'),
        ownerUid: 'alice',
        fileName: 'clip.mp4',
        contentType: 'video/mp4',
      })
    );
  });

  it('bloqueia upload sem autenticação', async () => {
    await assertFails(
      uploadVideo({
        storage: unauthenticatedStorage(),
        ownerUid: 'alice',
        fileName: 'clip.mp4',
        contentType: 'video/mp4',
      })
    );
  });

  it('mantém o vídeo privado sem leitura direta pelo proprietário', async () => {
    const storage = authenticatedStorage('alice');
    const videoRef = ref(storage, 'users/alice/uploads/videos/clip.mp4');

    await assertSucceeds(
      uploadBytes(videoRef, SMALL_VIDEO, { contentType: 'video/mp4' })
    );
    await assertFails(getBytes(videoRef));
  });

  it('revalida o MIME em atualizações do mesmo objeto', async () => {
    const storage = authenticatedStorage('alice');
    const videoRef = ref(storage, 'users/alice/uploads/videos/clip.mp4');

    await assertSucceeds(
      uploadBytes(videoRef, SMALL_VIDEO, { contentType: 'video/mp4' })
    );
    await assertFails(
      uploadBytes(videoRef, SMALL_VIDEO, { contentType: 'video/x-matroska' })
    );
    await assertSucceeds(
      uploadBytes(videoRef, SMALL_VIDEO, { contentType: 'video/webm' })
    );
  });

  it('permite exclusão somente ao proprietário', async () => {
    const ownerRef = ref(
      authenticatedStorage('alice'),
      'users/alice/uploads/videos/clip.mp4'
    );

    await assertSucceeds(
      uploadBytes(ownerRef, SMALL_VIDEO, { contentType: 'video/mp4' })
    );

    const otherUserRef = ref(
      authenticatedStorage('bob'),
      'users/alice/uploads/videos/clip.mp4'
    );

    await assertFails(deleteObject(otherUserRef));
    await assertSucceeds(deleteObject(ownerRef));
  });
});

describe('Storage Rules — staging limitado de fotos', () => {
  it('permite os dois slots fixos ao proprietário', async () => {
    const storage = authenticatedStorage('alice');

    await assertSucceeds(
      uploadPhoto({ storage, ownerUid: 'alice', slot: 'source-a' })
    );
    await assertSucceeds(
      uploadPhoto({ storage, ownerUid: 'alice', slot: 'source-b' })
    );
  });

  it('bloqueia slots e namespaces arbitrários', async () => {
    const storage = authenticatedStorage('alice');

    await assertFails(
      uploadPhoto({ storage, ownerUid: 'alice', slot: 'arquivo-extra' })
    );
    await assertFails(
      uploadBytes(
        ref(storage, 'users/alice/uploads/images/foto-livre.jpg'),
        SMALL_IMAGE,
        { contentType: 'image/jpeg' }
      )
    );
  });

  it('bloqueia leitura antes do registro backend', async () => {
    const storage = authenticatedStorage('alice');
    const photoRef = ref(
      storage,
      'users/alice/uploads/images/photo-1/source-a'
    );

    await assertSucceeds(
      uploadBytes(photoRef, SMALL_IMAGE, { contentType: 'image/jpeg' })
    );
    await assertFails(getBytes(photoRef));
  });

  it('libera leitura do proprietário após registro backend', async () => {
    const storage = authenticatedStorage('alice');
    const photoRef = ref(
      storage,
      'users/alice/uploads/images/photo-1/source-a'
    );

    await assertSucceeds(
      uploadBytes(photoRef, SMALL_IMAGE, { contentType: 'image/jpeg' })
    );
    await seedRegisteredPhoto('alice');
    await assertSucceeds(getBytes(photoRef));
  });

  it('não libera a foto registrada para outro usuário', async () => {
    const ownerStorage = authenticatedStorage('alice');
    const ownerRef = ref(
      ownerStorage,
      'users/alice/uploads/images/photo-1/source-a'
    );

    await assertSucceeds(
      uploadBytes(ownerRef, SMALL_IMAGE, { contentType: 'image/jpeg' })
    );
    await seedRegisteredPhoto('alice');

    const otherRef = ref(
      authenticatedStorage('bob'),
      'users/alice/uploads/images/photo-1/source-a'
    );
    await assertFails(getBytes(otherRef));
  });

  it('bloqueia upload de foto no perfil de outro usuário', async () => {
    await assertFails(
      uploadPhoto({
        storage: authenticatedStorage('bob'),
        ownerUid: 'alice',
      })
    );
  });

  it('bloqueia conteúdo que não seja imagem', async () => {
    await assertFails(
      uploadPhoto({
        storage: authenticatedStorage('alice'),
        ownerUid: 'alice',
        contentType: 'application/octet-stream',
      })
    );
  });

  it('permite exclusão do staging somente ao proprietário', async () => {
    const ownerRef = ref(
      authenticatedStorage('alice'),
      'users/alice/uploads/images/photo-1/source-a'
    );

    await assertSucceeds(
      uploadBytes(ownerRef, SMALL_IMAGE, { contentType: 'image/jpeg' })
    );

    const otherRef = ref(
      authenticatedStorage('bob'),
      'users/alice/uploads/images/photo-1/source-a'
    );

    await assertFails(deleteObject(otherRef));
    await assertSucceeds(deleteObject(ownerRef));
  });
});
