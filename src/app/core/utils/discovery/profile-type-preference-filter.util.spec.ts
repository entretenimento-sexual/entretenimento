// src/app/core/utils/discovery/profile-type-preference-filter.util.spec.ts
import { describe, expect, it } from 'vitest';

import { IUserDados } from '../../interfaces/iuser-dados';
import {
  evaluateDiscoveryCandidatePreference,
  filterDiscoveryCandidatesByViewerPreferences,
} from './profile-type-preference-filter.util';

function user(
  uid: string,
  patch: Partial<IUserDados> = {}
): IUserDados {
  return {
    uid,
    email: null,
    photoURL: null,
    role: 'free',
    lastLogin: 0,
    descricao: '',
    isSubscriber: false,
    ...patch,
  };
}

describe('profile type preference filter', () => {
  it('mantém todos os candidatos quando não existe filtro explícito', () => {
    const viewer = user('viewer');
    const candidates = [
      user('man', { gender: 'homem' }),
      user('woman', { gender: 'mulher' }),
    ];

    expect(filterDiscoveryCandidatesByViewerPreferences(candidates, viewer)).toHaveLength(2);
  });

  it('filtra homens e mulheres conforme a seleção explícita', () => {
    const viewer = user('viewer', {
      interestedInGenders: ['woman'],
      discoveryPreferences: {
        genderInterests: ['women'],
        acceptsCouples: true,
        acceptsSingles: true,
        acceptsTransProfiles: null,
        updatedAt: 1,
      },
    });

    const result = filterDiscoveryCandidatesByViewerPreferences(
      [
        user('man', { gender: 'homem' }),
        user('woman', { gender: 'mulher' }),
      ],
      viewer
    );

    expect(result.map((candidate) => candidate.uid)).toEqual(['woman']);
  });

  it('distingue as três variantes de casal', () => {
    const viewer = user('viewer', {
      interestedInGenders: ['couple'],
      discoveryPreferences: {
        genderInterests: ['couple_mf'],
        acceptsCouples: true,
        acceptsSingles: false,
        acceptsTransProfiles: null,
        updatedAt: 1,
      },
    });

    const result = filterDiscoveryCandidatesByViewerPreferences(
      [
        user('mm', { gender: 'casal-ele-ele' }),
        user('mf', { gender: 'casal-ele-ela' }),
        user('ff', { gender: 'casal-ela-ela' }),
      ],
      viewer
    );

    expect(result.map((candidate) => candidate.uid)).toEqual(['mf']);
  });

  it('respeita a exclusão explícita de perfis trans', () => {
    const viewer = user('viewer', {
      discoveryPreferences: {
        genderInterests: [],
        acceptsCouples: true,
        acceptsSingles: true,
        acceptsTransProfiles: false,
        updatedAt: 1,
      },
    });

    const result = filterDiscoveryCandidatesByViewerPreferences(
      [
        user('cis', { gender: 'mulher' }),
        user('trans', { gender: 'mulher-trans' }),
        user('travesti', { gender: 'travesti' }),
      ],
      viewer
    );

    expect(result.map((candidate) => candidate.uid)).toEqual(['cis']);
  });

  it('rejeita incompatibilidade recíproca explícita', () => {
    const viewer = user('viewer', {
      gender: 'homem',
      orientation: 'heterossexual',
      interestedInGenders: ['woman'],
      discoveryPreferences: {
        genderInterests: ['women'],
        acceptsCouples: true,
        acceptsSingles: true,
        acceptsTransProfiles: null,
        updatedAt: 1,
      },
    });

    const candidate = user('candidate', {
      gender: 'mulher',
      orientation: 'heterossexual',
      interestedInGenders: ['woman'],
    });

    expect(evaluateDiscoveryCandidatePreference(viewer, candidate)).toEqual({
      accepted: false,
      reason: 'reciprocal_mismatch',
    });
  });

  it('falha fechado para identidade desconhecida quando há tipos selecionados', () => {
    const viewer = user('viewer', {
      interestedInGenders: ['man'],
      discoveryPreferences: {
        genderInterests: ['men'],
        acceptsCouples: true,
        acceptsSingles: true,
        acceptsTransProfiles: null,
        updatedAt: 1,
      },
    });

    const result = evaluateDiscoveryCandidatePreference(
      viewer,
      user('unknown', { gender: undefined })
    );

    expect(result).toEqual({
      accepted: false,
      reason: 'profile_type_not_selected',
    });
  });
});
