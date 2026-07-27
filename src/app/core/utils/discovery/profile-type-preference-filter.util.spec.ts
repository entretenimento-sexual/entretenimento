// src/app/core/utils/discovery/profile-type-preference-filter.util.spec.ts
import { describe, expect, it } from 'vitest';

import type { IUserDados } from '../../interfaces/iuser-dados';
import type { IUserDiscoveryPreferences } from '../../interfaces/preferences/user-discovery-preferences.interface';
import {
  evaluateDiscoveryCandidatePreference,
  filterDiscoveryCandidatesByViewerPreferences,
} from './profile-type-preference-filter.util';

function user(uid: string, patch: Partial<IUserDados> = {}): IUserDados {
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

function preferences(
  patch: Partial<IUserDiscoveryPreferences> = {}
): IUserDiscoveryPreferences {
  return {
    genderInterests: [],
    relationshipIntents: [],
    acceptsCouples: true,
    acceptsSingles: true,
    acceptsTransProfiles: null,
    ageRange: null,
    maxDistanceKm: null,
    locationRequired: false,
    relationshipIntentMode: 'require',
    sexualPractices: [],
    sexualPracticeMode: 'prefer',
    bodyPreferences: [],
    bodyPreferenceMode: 'prefer',
    updatedAt: 1,
    ...patch,
  };
}

function subscribedUser(
  uid: string,
  role: 'basic' | 'premium' | 'vip',
  patch: Partial<IUserDados> = {}
): IUserDados {
  const now = Date.now();
  return user(uid, {
    role,
    tier: role,
    billingProjectionVersion: 1,
    isSubscriber: true,
    subscriptionStatus: 'active',
    subscriptionScope: 'platform_subscription',
    subscriptionStartedAt: now - 60_000,
    subscriptionEndsAt: now + 3_600_000,
    ...patch,
  });
}

describe('discovery preference policy', () => {
  it('mantém candidatos quando não existe política explícita', () => {
    expect(filterDiscoveryCandidatesByViewerPreferences([
      user('man', { gender: 'homem' }),
      user('woman', { gender: 'mulher' }),
    ], user('viewer'))).toHaveLength(2);
  });

  it('filtra tipos de perfil selecionados', () => {
    const viewer = user('viewer', {
      interestedInGenders: ['woman'],
      discoveryPreferences: preferences({ genderInterests: ['women'] }),
    });

    const result = filterDiscoveryCandidatesByViewerPreferences([
      user('man', { gender: 'homem' }),
      user('woman', { gender: 'mulher' }),
    ], viewer);

    expect(result.map((candidate) => candidate.uid)).toEqual(['woman']);
  });

  it('aplica faixa etária e falha fechado quando idade pública falta', () => {
    const viewer = user('viewer', {
      discoveryPreferences: preferences({ ageRange: { min: 25, max: 40 } }),
    });

    expect(evaluateDiscoveryCandidatePreference(viewer, user('young', { age: 22 })).reason)
      .toBe('age_out_of_range');
    expect(evaluateDiscoveryCandidatePreference(viewer, user('unknown')).reason)
      .toBe('age_missing');
    expect(evaluateDiscoveryCandidatePreference(viewer, user('ok', { age: 31 })).accepted)
      .toBe(true);
  });

  it('aplica distância e exige localização somente quando configurado', () => {
    const optionalLocation = user('viewer', {
      discoveryPreferences: preferences({ maxDistanceKm: 20, locationRequired: false }),
    });
    const requiredLocation = user('viewer', {
      discoveryPreferences: preferences({ maxDistanceKm: 20, locationRequired: true }),
    });

    expect(evaluateDiscoveryCandidatePreference(optionalLocation, user('unknown')).accepted)
      .toBe(true);
    expect(evaluateDiscoveryCandidatePreference(requiredLocation, user('unknown')).reason)
      .toBe('location_required');
    expect(evaluateDiscoveryCandidatePreference(requiredLocation, user('far', { distanciaKm: 30 })).reason)
      .toBe('outside_max_distance');
  });

  it('intenção obrigatória remove candidato sem interseção', () => {
    const viewer = user('viewer', {
      discoveryPreferences: preferences({
        relationshipIntents: ['serious'],
        relationshipIntentMode: 'require',
      }),
    });

    expect(evaluateDiscoveryCandidatePreference(viewer, user('casual', {
      publicRelationshipIntents: ['casual'],
    })).reason).toBe('relationship_intent_mismatch');
  });

  it('intenção preferida mantém candidato e produz afinidade', () => {
    const viewer = user('viewer', {
      discoveryPreferences: preferences({
        relationshipIntents: ['serious', 'dating'],
        relationshipIntentMode: 'prefer',
      }),
    });

    const result = evaluateDiscoveryCandidatePreference(viewer, user('candidate', {
      publicRelationshipIntents: ['dating'],
    }));

    expect(result.accepted).toBe(true);
    expect(result.preferenceScore).toBe(0.5);
    expect(result.matchedSignals).toContain('relationship_intent');
  });

  it('Básico usa práticas e características para ranking sem excluir', () => {
    const viewer = subscribedUser('viewer', 'basic', {
      discoveryPreferences: preferences({
        sexualPractices: ['bdsm'],
        sexualPracticeMode: 'require',
        bodyPreferences: ['tattoos'],
        bodyPreferenceMode: 'require',
      }),
    });

    const result = evaluateDiscoveryCandidatePreference(viewer, user('candidate', {
      publicSexualPractices: [],
      publicBodyTraits: [],
    }));

    expect(result.accepted).toBe(true);
    expect(result.preferenceScore).toBe(0);
  });

  it('Premium honra filtros avançados obrigatórios', () => {
    const viewer = subscribedUser('viewer', 'premium', {
      discoveryPreferences: preferences({
        bodyPreferences: ['tattoos'],
        bodyPreferenceMode: 'require',
      }),
    });

    expect(evaluateDiscoveryCandidatePreference(viewer, user('without-traits', {
      publicBodyTraits: [],
    })).reason).toBe('body_trait_missing');

    expect(evaluateDiscoveryCandidatePreference(viewer, user('matching', {
      publicBodyTraits: ['tattoos'],
    })).accepted).toBe(true);
  });

  it('compara característica desejada com trait declarado, não com preferência do candidato', () => {
    const viewer = subscribedUser('viewer', 'premium', {
      discoveryPreferences: preferences({
        bodyPreferences: ['athletic'],
        bodyPreferenceMode: 'require',
      }),
    });

    const candidate = user('candidate', {
      publicBodyTraits: ['curvy'],
      discoveryPreferences: preferences({ bodyPreferences: ['athletic'] }),
    });

    expect(evaluateDiscoveryCandidatePreference(viewer, candidate).reason)
      .toBe('body_trait_mismatch');
  });

  it('mantém reciprocidade quando há interesse de gênero explícito', () => {
    const viewer = user('viewer', {
      gender: 'homem',
      orientation: 'heterossexual',
      interestedInGenders: ['woman'],
      discoveryPreferences: preferences({ genderInterests: ['women'] }),
    });
    const candidate = user('candidate', {
      gender: 'mulher',
      orientation: 'heterossexual',
      interestedInGenders: ['woman'],
    });

    expect(evaluateDiscoveryCandidatePreference(viewer, candidate).reason)
      .toBe('reciprocal_mismatch');
  });
});
