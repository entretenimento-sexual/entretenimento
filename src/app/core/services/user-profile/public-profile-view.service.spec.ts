import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { IUserDados } from '../../interfaces/iuser-dados';
import { CurrentUserStoreService } from '../autentication/auth/current-user-store.service';
import { FirestoreContextService } from '../data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { DistanceCalculationService } from '../geolocation/distance-calculation.service';
import { PrivacyDebugLoggerService } from '../privacy/privacy-debug-logger.service';
import { PublicProfileViewService } from './public-profile-view.service';

describe('PublicProfileViewService', () => {
  it('mapeia somente dados públicos e calcula distância com a localização do visitante', async () => {
    const viewer$ = new BehaviorSubject<IUserDados | null | undefined>({
      uid: 'viewer-uid',
      email: null,
      photoURL: null,
      role: 'free',
      lastLogin: 0,
      descricao: '',
      isSubscriber: false,
      latitude: -22.9519,
      longitude: -43.2105,
    } as IUserDados);
    const publicProfile = {
      uid: 'target-uid',
      nickname: 'Pessoa pública',
      photoURL: 'https://example.test/profile.webp',
      role: 'premium',
      gender: 'mulher',
      orientation: 'bissexual',
      age: 32,
      municipio: 'Rio de Janeiro',
      estado: 'RJ',
      latitude: -22.9068,
      longitude: -43.1729,
      geohash: '75cm',
      descricao: 'Primeiro parágrafo.\n\nSegundo parágrafo.',
      preferenceBadgesVisible: true,
      publicRelationshipIntents: ['dating', 'swing'],
      publicSexualPractices: ['bdsm'],
      publicBodyTraits: ['tattoos'],
      createdAt: new Date('2022-01-01T00:00:00Z'),
    };
    const snapshot = {
      exists: () => true,
      data: () => publicProfile,
    };
    const firestoreContext = {
      deferObservable$: vi.fn(() => of(snapshot)),
    };
    const currentUserStore = {
      user$: viewer$.asObservable(),
      getSnapshot: vi.fn(() => viewer$.value),
    };
    const globalError = { handleError: vi.fn() };
    const privacyDebug = { log: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        PublicProfileViewService,
        DistanceCalculationService,
        { provide: Firestore, useValue: {} },
        {
          provide: FirestoreContextService,
          useValue: firestoreContext,
        },
        {
          provide: CurrentUserStoreService,
          useValue: currentUserStore,
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: globalError,
        },
        {
          provide: PrivacyDebugLoggerService,
          useValue: privacyDebug,
        },
      ],
    });

    const service = TestBed.inject(PublicProfileViewService);
    const result = await firstValueFrom(service.watchProfile$('target-uid'));

    expect(result?.uid).toBe('target-uid');
    expect(result?.idade).toBe(32);
    expect(result?.age).toBe(32);
    expect(result?.descricao).toBe(
      'Primeiro parágrafo.\n\nSegundo parágrafo.'
    );
    expect(result?.publicRelationshipIntents).toEqual(['dating', 'swing']);
    expect(result?.publicSexualPractices).toEqual(['bdsm']);
    expect(result?.publicBodyTraits).toEqual(['tattoos']);
    expect(result?.distanciaKm).toBeGreaterThan(0);
    expect(result?.latitude).toBeUndefined();
    expect(result?.longitude).toBeUndefined();
    expect(firestoreContext.deferObservable$).toHaveBeenCalledTimes(1);
    expect(globalError.handleError).not.toHaveBeenCalled();
  });

  it('não inventa distância quando uma das localizações não está disponível', async () => {
    const viewer$ = new BehaviorSubject<IUserDados | null | undefined>({
      uid: 'viewer-uid',
      email: null,
      photoURL: null,
      role: 'free',
      lastLogin: 0,
      descricao: '',
      isSubscriber: false,
    } as IUserDados);
    const snapshot = {
      exists: () => true,
      data: () => ({
        uid: 'target-uid',
        nickname: 'Pessoa pública',
        role: 'free',
        latitude: -22.9068,
        longitude: -43.1729,
      }),
    };

    TestBed.configureTestingModule({
      providers: [
        PublicProfileViewService,
        DistanceCalculationService,
        { provide: Firestore, useValue: {} },
        {
          provide: FirestoreContextService,
          useValue: { deferObservable$: vi.fn(() => of(snapshot)) },
        },
        {
          provide: CurrentUserStoreService,
          useValue: {
            user$: viewer$.asObservable(),
            getSnapshot: vi.fn(() => viewer$.value),
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: { handleError: vi.fn() },
        },
        {
          provide: PrivacyDebugLoggerService,
          useValue: { log: vi.fn() },
        },
      ],
    });

    const service = TestBed.inject(PublicProfileViewService);
    const result = await firstValueFrom(service.watchProfile$('target-uid'));

    expect(result?.distanciaKm).toBeUndefined();
  });
});
