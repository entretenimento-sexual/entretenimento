import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeRequestedPublicVideoReference,
  resolveStoredDirectMessagePublicVideoReference,
} from './direct-message-public-video-reference.policy';

const REQUESTED = Object.freeze({ ownerUid: 'owner_1', videoId: 'video_1' });
const PUBLIC_VIDEO = Object.freeze({
  ownerUid: 'owner_1',
  mediaType: 'VIDEO',
  visibility: 'PUBLIC',
  moderationStatus: 'APPROVED',
  title: '  Vídeo público  ',
  url: 'https://signed.example/video',
  storagePath: 'private/path',
});
const PUBLICATION = Object.freeze({
  ownerUid: 'owner_1',
  videoId: 'video_1',
  isPublished: true,
  visibility: 'PUBLIC',
  moderationStatus: 'APPROVED',
});

test('normaliza somente identificadores seguros', () => {
  assert.deepEqual(
    normalizeRequestedPublicVideoReference(REQUESTED),
    REQUESTED
  );
  assert.equal(
    normalizeRequestedPublicVideoReference({
      ownerUid: '../owner',
      videoId: 'video_1',
    }),
    null
  );
});

test('gera referência mínima para vídeo público e aprovado', () => {
  const result = resolveStoredDirectMessagePublicVideoReference({
    requested: REQUESTED,
    publicProfileExists: true,
    publicVideo: PUBLIC_VIDEO,
    publication: PUBLICATION,
  });

  assert.deepEqual(result, {
    kind: 'PUBLIC_VIDEO',
    ownerUid: 'owner_1',
    videoId: 'video_1',
    title: 'Vídeo público',
  });
  assert.equal('url' in (result ?? {}), false);
  assert.equal('storagePath' in (result ?? {}), false);
});

test('rejeita vídeo removido, privado ou sem publicação ativa', () => {
  assert.equal(
    resolveStoredDirectMessagePublicVideoReference({
      requested: REQUESTED,
      publicProfileExists: false,
      publicVideo: PUBLIC_VIDEO,
      publication: PUBLICATION,
    }),
    null
  );
  assert.equal(
    resolveStoredDirectMessagePublicVideoReference({
      requested: REQUESTED,
      publicProfileExists: true,
      publicVideo: { ...PUBLIC_VIDEO, visibility: 'PRIVATE' },
      publication: PUBLICATION,
    }),
    null
  );
  assert.equal(
    resolveStoredDirectMessagePublicVideoReference({
      requested: REQUESTED,
      publicProfileExists: true,
      publicVideo: PUBLIC_VIDEO,
      publication: { ...PUBLICATION, isPublished: false },
    }),
    null
  );
});

test('rejeita divergência entre a referência e os documentos', () => {
  assert.equal(
    resolveStoredDirectMessagePublicVideoReference({
      requested: REQUESTED,
      publicProfileExists: true,
      publicVideo: { ...PUBLIC_VIDEO, ownerUid: 'other' },
      publication: PUBLICATION,
    }),
    null
  );
});
