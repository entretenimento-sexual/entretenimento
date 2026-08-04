import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeRequestedPublicVideoReference,
  resolveStoredDirectMessagePublicVideoReference,
} from './direct-message-public-video-reference.policy';

const REQUESTED = Object.freeze({ ownerUid: 'owner_1', videoId: 'video_1' });
const PUBLIC_VIDEO = Object.freeze({
  id: 'video_1',
  ownerUid: 'owner_1',
  mediaType: 'VIDEO',
  assetAccess: 'SIGNED_URL',
  visibility: 'PUBLIC',
  moderationStatus: 'APPROVED',
  title: 'Título que não deve ser persistido',
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

function resolve(overrides: {
  publicProfileExists?: boolean;
  publicVideo?: Record<string, unknown>;
  publication?: Record<string, unknown>;
  senderAuthorized?: boolean;
  recipientAuthorized?: boolean;
} = {}) {
  return resolveStoredDirectMessagePublicVideoReference({
    requested: REQUESTED,
    publicProfileExists: overrides.publicProfileExists ?? true,
    publicVideo: overrides.publicVideo ?? PUBLIC_VIDEO,
    publication: overrides.publication ?? PUBLICATION,
    senderAuthorized: overrides.senderAuthorized ?? true,
    recipientAuthorized: overrides.recipientAuthorized ?? true,
  });
}

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

test('gera referência mínima sem título, URL ou path mutável', () => {
  const result = resolve();

  assert.deepEqual(result, {
    kind: 'PUBLIC_VIDEO',
    ownerUid: 'owner_1',
    videoId: 'video_1',
    title: 'Vídeo compartilhado',
  });
  assert.equal('url' in (result ?? {}), false);
  assert.equal('storagePath' in (result ?? {}), false);
  assert.notEqual(result?.title, PUBLIC_VIDEO.title);
});

test('exige autorização do remetente e do destinatário', () => {
  assert.equal(resolve({ senderAuthorized: false }), null);
  assert.equal(resolve({ recipientAuthorized: false }), null);
});

test('aceita audiência FRIENDS quando a política externa autorizou ambos', () => {
  const result = resolve({
    publicVideo: { ...PUBLIC_VIDEO, visibility: 'FRIENDS' },
    publication: { ...PUBLICATION, visibility: 'FRIENDS' },
  });

  assert.equal(result?.kind, 'PUBLIC_VIDEO');
});

test('rejeita vídeo removido, privado ou sem publicação ativa', () => {
  assert.equal(resolve({ publicProfileExists: false }), null);
  assert.equal(
    resolve({
      publicVideo: { ...PUBLIC_VIDEO, visibility: 'PRIVATE' },
      publication: { ...PUBLICATION, visibility: 'PRIVATE' },
    }),
    null
  );
  assert.equal(
    resolve({
      publication: { ...PUBLICATION, isPublished: false },
    }),
    null
  );
});

test('rejeita divergência entre a referência e os documentos canônicos', () => {
  assert.equal(
    resolve({
      publicVideo: { ...PUBLIC_VIDEO, ownerUid: 'other' },
    }),
    null
  );
  assert.equal(
    resolve({
      publicVideo: { ...PUBLIC_VIDEO, visibility: 'FRIENDS' },
      publication: PUBLICATION,
    }),
    null
  );
  assert.equal(
    resolve({
      publicVideo: { ...PUBLIC_VIDEO, assetAccess: 'PUBLIC_URL' },
    }),
    null
  );
});
