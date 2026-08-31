import { describe, expect, it } from 'vitest';

import { normalizePublicUserPreview } from './public-user-preview.model';

describe('normalizePublicUserPreview', () => {
  it('separa identidade pública de contexto complementar', () => {
    const preview = normalizePublicUserPreview({
      uid: 'user-1',
      nickname: 'serale',
      gender: 'mulher',
      municipio: 'Rio de Janeiro',
      estado: 'RJ',
      idade: 31,
      orientation: 'bissexual',
      isOnline: true,
      descricao: 'Conversas, encontros e novas amizades.',
      civilName: 'não deve atravessar',
      latitude: -22.9,
      longitude: -43.2,
    }, {
      approximateDistanceKm: 4.24,
    });

    expect(preview).toMatchObject({
      age: 31,
      orientationLabel: 'bissexual',
      isOnline: true,
      approximateDistanceKm: 4.2,
      bioPreview: 'Conversas, encontros e novas amizades.',
      identity: {
        profileId: 'user-1',
        nickname: 'serale',
        identityShortLabel: 'Mulher',
        city: 'Rio de Janeiro',
        state: 'RJ',
      },
    });
    expect('civilName' in (preview ?? {})).toBe(false);
    expect('latitude' in (preview ?? {})).toBe(false);
    expect('longitude' in (preview ?? {})).toBe(false);
  });

  it('falha fechado para idade, distância e bio inválidas', () => {
    const preview = normalizePublicUserPreview({
      nickname: 'perfil_seguro',
      idade: 17,
      descricao: '\u0000   ',
    }, {
      approximateDistanceKm: -1,
    });

    expect(preview?.age).toBeNull();
    expect(preview?.approximateDistanceKm).toBeNull();
    expect(preview?.bioPreview).toBeNull();
  });
});
