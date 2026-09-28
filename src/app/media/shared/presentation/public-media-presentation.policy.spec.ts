import { describe, expect, it } from 'vitest';

import { resolvePublicMediaRecommendationContext } from './public-media-presentation.policy';

describe('resolvePublicMediaRecommendationContext', () => {
  it('prioriza contexto explícito de perfil', () => {
    expect(
      resolvePublicMediaRecommendationContext({
        source: 'profile',
        ownerUid: 'owner-1',
        continuationContext: {
          connectionOwnerUids: ['owner-1'],
          compatibleOwnerUids: ['owner-1'],
        },
      })?.key
    ).toBe('profile');
  });

  it('prioriza rede sobre compatibilidade em continuação', () => {
    expect(
      resolvePublicMediaRecommendationContext({
        source: 'discover',
        ownerUid: 'owner-1',
        continuationContext: {
          connectionOwnerUids: ['owner-1'],
          compatibleOwnerUids: ['owner-1'],
        },
      })?.key
    ).toBe('network');
  });

  it('mantém patrocinado explícito e separado do contexto orgânico', () => {
    const context = resolvePublicMediaRecommendationContext({
      source: 'sponsored',
      ownerUid: 'owner-1',
      continuationContext: null,
    });

    expect(context).toMatchObject({
      key: 'sponsored',
      label: 'Patrocinado',
      commercial: true,
    });
  });

  it('normaliza boosted no mesmo contexto visual comercial sem mudar ranking', () => {
    expect(
      resolvePublicMediaRecommendationContext({
        source: 'boosted',
        ownerUid: 'owner-1',
      })
    ).toMatchObject({
      key: 'sponsored',
      commercial: true,
    });
  });

  it('não inventa contexto quando a origem é desconhecida', () => {
    expect(
      resolvePublicMediaRecommendationContext({
        source: 'unknown',
        ownerUid: 'owner-1',
      })
    ).toBeNull();
  });
});
