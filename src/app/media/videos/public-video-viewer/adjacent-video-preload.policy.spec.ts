import { describe, expect, it } from 'vitest';

import type { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { selectAdjacentVideoForPreload } from './adjacent-video-preload.policy';

const NOW = 1_800_000_000_000;

function createVideo(
  id: string,
  accessExpiresAt = NOW + 300_000
): IPublicVideoItem {
  return {
    id,
    ownerUid: 'owner-1',
    url: `https://example.test/${id}.mp4?token=temporary`,
    accessExpiresAt,
  } as IPublicVideoItem;
}

describe('adjacent video preload policy', () => {
  it('prioriza o próximo vídeo após navegação para frente', () => {
    const items = [createVideo('one'), createVideo('two'), createVideo('three')];

    expect(selectAdjacentVideoForPreload(items, 1, 'next', NOW)?.id)
      .toBe('three');
  });

  it('prioriza o vídeo anterior após navegação para trás', () => {
    const items = [createVideo('one'), createVideo('two'), createVideo('three')];

    expect(selectAdjacentVideoForPreload(items, 1, 'previous', NOW)?.id)
      .toBe('one');
  });

  it('ignora URL próxima da expiração e usa o outro adjacente', () => {
    const items = [
      createVideo('one'),
      createVideo('two'),
      createVideo('three', NOW + 20_000),
    ];

    expect(selectAdjacentVideoForPreload(items, 1, 'next', NOW)?.id)
      .toBe('one');
  });

  it('retorna null quando não há adjacente utilizável', () => {
    const items = [createVideo('only', NOW + 20_000)];

    expect(selectAdjacentVideoForPreload(items, 0, 'next', NOW)).toBeNull();
  });
});
