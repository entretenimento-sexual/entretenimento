import { describe, expect, it } from 'vitest';

import {
  buildPrivateVideoPreviewCacheKey,
  PrivateVideoPreviewCache,
  PRIVATE_VIDEO_PREVIEW_MAX_CACHE_ENTRIES,
  PRIVATE_VIDEO_PREVIEW_REFRESH_SAFETY_MS,
} from './private-video-preview-cache';

const NOW = 1_800_000_000_000;

function key(uid: string, revision = 1, epoch = 1): string {
  return buildPrivateVideoPreviewCacheKey({
    sessionScope: `session:uid:${uid}:epoch:${epoch}`,
    ownerUid: uid,
    videoId: 'video-1',
    revision,
    status: 'ready',
  });
}

describe('private video preview cache', () => {
  it('reutiliza somente poster dentro do prazo e sem acessar playback', () => {
    const cache = new PrivateVideoPreviewCache();
    const id = key('owner-a');
    const preview = {
      posterUrl: 'https://example.test/poster-1',
      posterPath: 'users/owner-a/uploads/video-posters/video-1/poster.jpg',
      expiresAt: NOW + 10 * 60_000,
    };

    cache.set(id, preview, NOW);
    expect(cache.get(id, NOW + 60_000)).toEqual(preview);
    expect(cache.get(id, NOW + 8 * 60_000)).toBeNull();
  });

  it('ignora URL expirada, inválida ou com validade residual insuficiente', () => {
    const cache = new PrivateVideoPreviewCache();
    const id = key('owner-a');

    cache.set(id, {
      posterUrl: 'javascript:alert(1)',
      posterPath: null,
      expiresAt: NOW + 10 * 60_000,
    }, NOW);
    expect(cache.get(id, NOW)).toBeNull();

    cache.set(id, {
      posterUrl: 'https://example.test/poster',
      posterPath: null,
      expiresAt: NOW + PRIVATE_VIDEO_PREVIEW_REFRESH_SAFETY_MS,
    }, NOW);
    expect(cache.get(id, NOW)).toBeNull();
  });

  it('permite cache negativo de poster ausente, sem URL inventada', () => {
    const cache = new PrivateVideoPreviewCache();
    const id = key('owner-a');
    const absentPoster = {
      posterUrl: null,
      posterPath: null,
      expiresAt: NOW + 10 * 60_000,
    };

    cache.set(id, absentPoster, NOW);
    expect(cache.get(id, NOW)).toEqual(absentPoster);
  });

  it('particiona por sessão, proprietário, vídeo e revisão', () => {
    expect(key('owner-a')).not.toBe(key('owner-b'));
    expect(key('owner-a', 1, 1)).not.toBe(key('owner-a', 1, 2));
    expect(key('owner-a', 1, 1)).not.toBe(key('owner-a', 2, 1));
  });

  it('limita LRU de posters e elimina credenciais ao limpar sessão', () => {
    const cache = new PrivateVideoPreviewCache();
    for (let index = 0; index < PRIVATE_VIDEO_PREVIEW_MAX_CACHE_ENTRIES; index += 1) {
      cache.set(String(index), {
        posterUrl: `https://example.test/${index}`,
        posterPath: null,
        expiresAt: NOW + 10 * 60_000,
      }, NOW);
    }

    expect(cache.get('0', NOW)).not.toBeNull();
    cache.set('novo', {
      posterUrl: 'https://example.test/novo',
      posterPath: null,
      expiresAt: NOW + 10 * 60_000,
    }, NOW);

    expect(cache.get('1', NOW)).toBeNull();
    expect(cache.get('0', NOW)).not.toBeNull();
    cache.clear();
    expect(cache.get('0', NOW)).toBeNull();
    expect(cache.get('novo', NOW)).toBeNull();
  });
});
