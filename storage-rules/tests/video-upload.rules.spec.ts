import { readFileSync } from 'node:fs';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
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
const STORAGE_HOST = '127.0.0.1';
const STORAGE_PORT = 9299;
const SMALL_VIDEO = new Uint8Array([0, 1, 2, 3]);

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

beforeAll(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: {
      host: STORAGE_HOST,
      port: STORAGE_PORT,
      rules: readFileSync('storage.rules', 'utf8'),
    },
  });
});

beforeEach(async () => {
  await testEnvironment.clearStorage();
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
