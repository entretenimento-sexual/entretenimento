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
import { afterAll, beforeAll, describe, it } from 'vitest';

const PROJECT_ID = 'demo-entretenimento-storage-rules';
const BUCKET_URL = `gs://${PROJECT_ID}.appspot.com`;
const STORAGE_HOST = '127.0.0.1';
const STORAGE_PORT = 9299;
const VTT_CONTENT = new TextEncoder().encode(
  'WEBVTT\n\n00:00.000 --> 00:02.000\nOlá.\n'
);

let testEnvironment: RulesTestEnvironment;

function authenticatedStorage(uid: string): FirebaseStorage {
  return testEnvironment.authenticatedContext(uid).storage(BUCKET_URL);
}

function captionRef(
  storage: FirebaseStorage,
  ownerUid: string,
  videoId: string,
  fileName = 'captions.vtt'
) {
  return ref(
    storage,
    `users/${ownerUid}/uploads/video-captions/${videoId}/${fileName}`
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

afterAll(async () => {
  await testEnvironment.cleanup();
});

describe('Storage Rules — legendas privadas WebVTT', () => {
  it('permite upload WebVTT ao proprietário', async () => {
    const storage = authenticatedStorage('caption-owner-1');

    await assertSucceeds(
      uploadBytes(
        captionRef(storage, 'caption-owner-1', 'video-1'),
        VTT_CONTENT,
        { contentType: 'text/vtt' }
      )
    );
  });

  it('nega leitura direta mesmo ao proprietário', async () => {
    const storage = authenticatedStorage('caption-owner-2');
    const objectRef = captionRef(storage, 'caption-owner-2', 'video-2');

    await assertSucceeds(
      uploadBytes(objectRef, VTT_CONTENT, { contentType: 'text/vtt' })
    );
    await assertFails(getBytes(objectRef));
  });

  it('nega upload no namespace de outro usuário', async () => {
    const storage = authenticatedStorage('caption-attacker');

    await assertFails(
      uploadBytes(
        captionRef(storage, 'caption-owner-3', 'video-3'),
        VTT_CONTENT,
        { contentType: 'text/vtt' }
      )
    );
  });

  it('nega MIME e extensão incompatíveis', async () => {
    const storage = authenticatedStorage('caption-owner-4');

    await assertFails(
      uploadBytes(
        captionRef(storage, 'caption-owner-4', 'video-4'),
        VTT_CONTENT,
        { contentType: 'text/plain' }
      )
    );
    await assertFails(
      uploadBytes(
        captionRef(
          storage,
          'caption-owner-4',
          'video-4',
          'captions.txt'
        ),
        VTT_CONTENT,
        { contentType: 'text/vtt' }
      )
    );
  });

  it('permite exclusão somente ao proprietário', async () => {
    const ownerStorage = authenticatedStorage('caption-owner-5');
    const ownerRef = captionRef(
      ownerStorage,
      'caption-owner-5',
      'video-5'
    );

    await assertSucceeds(
      uploadBytes(ownerRef, VTT_CONTENT, { contentType: 'text/vtt' })
    );

    const attackerRef = captionRef(
      authenticatedStorage('caption-attacker-5'),
      'caption-owner-5',
      'video-5'
    );

    await assertFails(deleteObject(attackerRef));
    await assertSucceeds(deleteObject(ownerRef));
  });
});
