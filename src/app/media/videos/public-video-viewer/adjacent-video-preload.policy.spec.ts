import { describe, expect, it } from 'vitest';

import type { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import {
  canPreloadAdjacentVideoMetadata,
  selectAdjacentVideoForPreload,
} from './adjacent-video-preload.policy';

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
  it('permite metadados quando a aba e a conexão estão adequadas', () => {
    expect(canPreloadAdjacentVideoMetadata({
      isBrowser: true,
      online: true,
      visibilityState: 'visible',
      saveData: false,
      effectiveType: '4g',
      downlinkMbps: 10,
    })).toBe(true);
  });

  it.each([
    ['SSR', { isBrowser: false }],
    ['offline', { online: false }],
    ['aba oculta', { visibilityState: 'hidden' }],
    ['economia de dados', { saveData: true }],
    ['2G', { effectiveType: '2g' }],
    ['banda insuficiente', { downlinkMbps: 0.8 }],
  ])('bloqueia preload em %s', (_label, override) => {
    expect(canPreloadAdjacentVideoMetadata({
      isBrowser: true,
      online: true,
      visibilityState: 'visible',
      saveData: false,
      effectiveType: '4g',
      downlinkMbps: 10,
      ...override,
    })).toBe(false);
  });

  it('mantém compatibilidade quando o navegador não expõe Network Information', () => {
    expect(canPreloadAdjacentVideoMetadata({
      isBrowser: true,
      online: true,
      visibilityState: 'visible',
      saveData: false,
      effectiveType: null,
      downlinkMbps: null,
    })).toBe(true);
  });

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
});
