import { describe, expect, it } from 'vitest';

import { mapPublicVideoProjection } from './public-video-item.mapper';

describe('public-video owner normalization', () => {
  it('preserva o owner público hidratado quando a projeção é normalizada novamente', () => {
    const base = mapPublicVideoProjection({
      documentId: 'video-1',
      expectedOwnerUid: 'owner-1',
      data: {
        id: 'video-1',
        ownerUid: 'owner-1',
        mediaType: 'VIDEO',
        assetAccess: 'SIGNED_URL',
        posterAccess: 'SIGNED_URL',
        title: 'Vídeo público',
        mimeType: 'video/mp4',
        sizeBytes: 1024,
        durationMs: 8500,
        publishedAt: 1_700_000_100_000,
        visibility: 'PUBLIC',
        moderationStatus: 'APPROVED',
      },
    });

    expect(base).not.toBeNull();

    const normalizedAgain = mapPublicVideoProjection({
      documentId: base!.id,
      expectedOwnerUid: base!.ownerUid,
      data: {
        ...base!,
        owner: {
          nickname: 'prfseves RJ',
          photoURL: 'https://example.test/avatar.webp',
          gender: 'Mulher',
          orientation: 'Heterossexual',
          municipio: 'Rio de Janeiro',
          estado: 'RJ',
        },
      },
    });

    expect(normalizedAgain?.owner).toEqual({
      nickname: 'prfseves RJ',
      photoURL: 'https://example.test/avatar.webp',
      gender: 'Mulher',
      orientation: 'Heterossexual',
      municipio: 'Rio de Janeiro',
      estado: 'RJ',
    });
  });
});
