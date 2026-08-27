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

  it('deve preservar idade e sinais públicos usados pelo matching', () => {
    const card = mapPublicProfileCard({
      uid: 'profile-matching',
      nickname: 'Compatível',
      age: 34,
      publicRelationshipIntents: ['dating', 'dating', 'serious'],
      publicSexualPractices: ['bdsm', 'tantra'],
      publicBodyTraits: ['athletic', 'tattoos'],
      preferenceBadgesVisible: true,
      publicPreferencesUpdatedAt: {
        seconds: 1_720_000_000,
        nanoseconds: 250_000_000,
      },
    });

    expect(card).toMatchObject({
      age: 34,
      publicRelationshipIntents: ['dating', 'serious'],
      publicSexualPractices: ['bdsm', 'tantra'],
      publicBodyTraits: ['athletic', 'tattoos'],
      preferenceBadgesVisible: true,
      publicPreferencesUpdatedAt: 1_720_000_000_250,
    });
  });

  it('deve aceitar alias legado de idade sem perder o valor público', () => {
    const card = mapPublicProfileCard({
      uid: 'profile-age-alias',
      nickname: 'Idade pública',
      idade: '29',
    });

    expect(card?.age).toBe(29);
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

  it('deve tratar 0,0 legado como localização pública ausente', () => {
    const card = mapPublicProfileCard({
      uid: 'profile-zero-location',
      nickname: 'Sem posição válida',
      latitude: 0,
      longitude: 0,
      geohash: '7zzzz',
    });

    expect(card).toMatchObject({
      latitude: null,
      longitude: null,
      geohash: null,
    });
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
