// src/app/dashboard/discovery/application/discovery-card-enrichment.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import type { IUserDiscoveryPreferences } from 'src/app/core/interfaces/preferences/user-discovery-preferences.interface';
import { DistanceCalculationService } from 'src/app/core/services/geolocation/distance-calculation.service';

import { DiscoveryCardEnrichmentService } from './discovery-card-enrichment.service';

describe('DiscoveryCardEnrichmentService preference pipeline', () => {
  let service: DiscoveryCardEnrichmentService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        DiscoveryCardEnrichmentService,
        {
          provide: DistanceCalculationService,
          useValue: {
            calculateDistanceInKm: vi.fn(() => 10),
          },
        },
      ],
    });

    service = TestBed.inject(DiscoveryCardEnrichmentService);
  });

  it('prioriza a localização de runtime sobre coordenadas persistidas do viewer', () => {
    const viewer = user('viewer', {
      latitude: -10,
      longitude: -50,
    });
    const target = candidate('target', {
      latitude: -22.91,
      longitude: -43.17,
    });
    const calculator = TestBed.inject(DistanceCalculationService);

    service.buildCardsResult({
      profiles: [target],
      currentUser: viewer,
      currentUid: viewer.uid,
      mode: 'all',
      fallbackLocation: {
        latitude: -22.9,
        longitude: -43.2,
      },
      applyVisibility: false,
    });

    expect(calculator.calculateDistanceInKm).toHaveBeenCalledWith(
      -22.9,
      -43.2,
      -22.91,
      -43.17
    );
  });

  it('remove candidato fora da faixa etária obrigatória', () => {
    const viewer = user('viewer', {
      discoveryPreferences: preferences({
        ageRange: { min: 25, max: 40 },
      }),
    });

    const result = service.buildCardsResult({
      profiles: [candidate('young', { age: 22 })],
      currentUser: viewer,
      mode: 'all',
      applyVisibility: false,
    });

    expect(result.profiles).toEqual([]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ uid: 'young', reason: 'age_out_of_range' }),
    ]);
  });

  it('Básico mantém todos e ordena por prática preferida', () => {
    const viewer = subscribedUser('viewer', 'basic', {
      discoveryPreferences: preferences({
        sexualPractices: ['bdsm'],
        sexualPracticeMode: 'prefer',
      }),
    });

    const result = service.buildCardsResult({
      profiles: [
        candidate('without-match', { publicSexualPractices: ['tantra'] }),
        candidate('with-match', { publicSexualPractices: ['bdsm'] }),
      ],
      currentUser: viewer,
      mode: 'all',
      applyVisibility: false,
    });

    expect(result.profiles.map((profile) => profile.uid)).toEqual([
      'with-match',
      'without-match',
    ]);
    expect(result.profiles[0].preferenceMatchScore).toBe(1);
    expect(result.profiles[1].preferenceMatchScore).toBe(0);
  });

  it('Premium remove candidato que não atende característica obrigatória', () => {
    const viewer = subscribedUser('viewer', 'premium', {
      discoveryPreferences: preferences({
        bodyPreferences: ['tattoos'],
        bodyPreferenceMode: 'require',
      }),
    });

    const result = service.buildCardsResult({
      profiles: [
        candidate('without-trait', { publicBodyTraits: ['curvy'] }),
        candidate('with-trait', { publicBodyTraits: ['tattoos'] }),
      ],
      currentUser: viewer,
      mode: 'all',
      applyVisibility: false,
    });

    expect(result.profiles.map((profile) => profile.uid)).toEqual(['with-trait']);
    expect(result.rejected).toEqual([
      expect.objectContaining({
        uid: 'without-trait',
        reason: 'body_trait_mismatch',
      }),
    ]);
  });

  it('intenção em modo preferir influencia ranking sem excluir', () => {
    const viewer = user('viewer', {
      discoveryPreferences: preferences({
        relationshipIntents: ['serious'],
        relationshipIntentMode: 'prefer',
      }),
    });

    const result = service.buildCardsResult({
      profiles: [
        candidate('casual', { publicRelationshipIntents: ['casual'] }),
        candidate('serious', { publicRelationshipIntents: ['serious'] }),
      ],
      currentUser: viewer,
      mode: 'all',
      applyVisibility: false,
    });

    expect(result.profiles.map((profile) => profile.uid)).toEqual([
      'serious',
      'casual',
    ]);
    expect(result.rejected).toEqual([]);
  });
});

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

function user(uid: string, patch: Partial<IUserDados> = {}): IUserDados {
  return {
    uid,
    nickname: uid,
    email: null,
    photoURL: null,
    role: 'free',
    lastLogin: 0,
    descricao: '',
    isSubscriber: false,
    ...patch,
  };
}

function candidate(uid: string, patch: Partial<IUserDados> = {}): IUserDados {
  return user(uid, {
    gender: 'mulher',
    estado: 'RJ',
    municipio: 'Rio de Janeiro',
    ...patch,
  });
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
