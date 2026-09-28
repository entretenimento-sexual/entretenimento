import { describe, expect, it } from 'vitest';

import {
  hasOfficialMediaContext,
  resolvePublicMediaRecommendationContext,
} from './public-media-presentation.policy';

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

  it('só apresenta Oficial quando a projeção derivada é estruturalmente válida', () => {
    expect(
      hasOfficialMediaContext({
        officialMediaContext: {
          contexts: [{
            identity: { verified: true, type: 'profile' },
            association: { verified: true },
            target: { type: 'profile', id: 'owner-1' },
          }],
        },
      })
    ).toBe(true);

    expect(
      hasOfficialMediaContext({
        officialMediaContext: {
          contexts: [{
            identity: { verified: true, type: 'profile' },
            association: { verified: false },
            target: { type: 'profile', id: 'owner-1' },
          }],
        },
      })
    ).toBe(false);

    expect(
      hasOfficialMediaContext({
        officialMediaContext: {
          contexts: [{ arbitrary: true }],
        },
      })
    ).toBe(false);
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
