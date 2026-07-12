// src/app/dashboard/discovery/data-access/public-profile-card.mapper.spec.ts

import { describe, expect, it } from 'vitest';

import {
  mapPublicProfileCard,
  toSerializableEpoch,
} from './public-profile-card.mapper';

describe('public-profile-card.mapper', () => {
  it('deve normalizar aliases, métricas e timestamps para valores serializáveis', () => {
    const card = mapPublicProfileCard({
      uid: 'profile-1',
      nickname: 'Pessoa Teste',
      avatarUrl: 'https://example.com/avatar.webp',
      genero: 'homem',
      orientacaoSexual: 'homossexual',
      cidade: 'Rio de Janeiro',
      uf: 'RJ',
      latitude: '-22.9',
      longitude: '-43.2',
      publicMediaCount: 4,
      publicPhotosCount: 3,
      publicVideosCount: 1,
      profileViewsCount: 20,
      profileUniqueViewersCount: 7,
      mediaUniqueViewersCount: 11,
      publicLikesCount: 5,
      updatedAt: {
        seconds: 1_700_000_000,
        nanoseconds: 500_000_000,
      },
    });

    expect(card).toMatchObject({
      uid: 'profile-1',
      nickname: 'Pessoa Teste',
      photoURL: 'https://example.com/avatar.webp',
      gender: 'homem',
      orientation: 'homossexual',
      municipio: 'Rio de Janeiro',
      estado: 'RJ',
      latitude: -22.9,
      longitude: -43.2,
      mediaCount: 4,
      photosCount: 3,
      videosCount: 1,
      viewsCount: 20,
      profileUniqueViewersCount: 7,
      uniqueViewersCount: 7,
      mediaUniqueViewersCount: 11,
      likesCount: 5,
      updatedAt: 1_700_000_000_500,
    });
  });

  it('deve priorizar o contador único do perfil sobre o alias legado', () => {
    const card = mapPublicProfileCard({
      uid: 'profile-viewers',
      nickname: 'Audiência',
      profileUniqueViewersCount: 3,
      uniqueViewersCount: 9,
    });

    expect(card?.profileUniqueViewersCount).toBe(3);
    expect(card?.uniqueViewersCount).toBe(3);
  });

  it('deve remover duplicidades das preferências públicas', () => {
    const card = mapPublicProfileCard({
      uid: 'profile-2',
      nickname: 'Teste',
      interestedInGenders: ['man', 'man', 'woman'],
    });

    expect(card?.interestedInGenders).toEqual(['man', 'woman']);
  });

  it('deve recusar projeção sem nickname público', () => {
    expect(mapPublicProfileCard({ uid: 'profile-3' })).toBeNull();
  });

  it('deve converter Date e Timestamp-like sem manter objetos no resultado', () => {
    expect(toSerializableEpoch(new Date(1_700_000_000_000))).toBe(
      1_700_000_000_000
    );

    expect(
      toSerializableEpoch({
        toMillis: () => 1_710_000_000_000,
      })
    ).toBe(1_710_000_000_000);
  });
});
