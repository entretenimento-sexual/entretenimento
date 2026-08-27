import { describe, expect, it } from 'vitest';

import {
  buildPublicMediaAccessCacheKey,
  resolvePublicMediaAssetVersion,
} from './public-media-access-cache-key';

describe('public-media-access-cache-key', () => {
  it('prioriza assetVersion sobre publishedAt', () => {
    expect(resolvePublicMediaAssetVersion({
      assetVersion: 1_800_000_200_000,
      publishedAt: 1_800_000_100_000,
    })).toBe(1_800_000_200_000);
  });

  it('usa publishedAt como fallback para projeções legadas', () => {
    expect(resolvePublicMediaAssetVersion({
      publishedAt: {
        toMillis: () => 1_700_000_100_000,
      },
    })).toBe(1_700_000_100_000);
  });

  it('mantém a chave estável quando somente metadados sociais mudam', () => {
    const input = {
      namespace: 'public-video-access' as const,
      ownerUid: 'owner-1',
      mediaId: 'video-1',
      assetVersion: 1_800_000_100_000,
      publishedAt: 1_800_000_000_000,
    };

    const first = buildPublicMediaAccessCacheKey(input);
    const afterSocialUpdate = buildPublicMediaAccessCacheKey({
      ...input,
      // `updatedAt` é propositalmente inexistente neste contrato.
      // Alterações sociais não podem participar da versão do ativo.
    });

    expect(afterSocialUpdate).toBe(first);
  });

  it('invalida a chave quando o arquivo público recebe nova assetVersion', () => {
    const first = buildPublicMediaAccessCacheKey({
      namespace: 'public-photo-access',
      ownerUid: 'owner-1',
      mediaId: 'photo-1',
      assetVersion: 1_800_000_100_000,
      publishedAt: 1_800_000_000_000,
    });
    const replaced = buildPublicMediaAccessCacheKey({
      namespace: 'public-photo-access',
      ownerUid: 'owner-1',
      mediaId: 'photo-1',
      assetVersion: 1_800_000_200_000,
      publishedAt: 1_800_000_000_000,
    });

    expect(replaced).not.toBe(first);
  });
});
