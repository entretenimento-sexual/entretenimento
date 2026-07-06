// src/app/store/effects/effects.location/nearby-profiles.effects.spec.ts
import { TestBed } from '@angular/core/testing';
import { ReplaySubject, firstValueFrom } from 'rxjs';
import { Action } from '@ngrx/store';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';

import { NearbyProfilesEffects } from './nearby-profiles.effects';
import { NearbyProfilesActions } from '../../actions/actions.location/nearby-profiles.actions';
import {
  buildNearbyKey,
  initialNearbyProfilesState,
  NearbyEntry,
  NearbyProfilesState,
} from '../../states/states.location/nearby-profiles.state';

import { NearbyProfilesService } from '../../../core/services/geolocation/near-profile.service';
import { ErrorNotificationService } from '../../../core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../../core/services/error-handler/global-error-handler.service';
import { IUserDados } from '../../../core/interfaces/iuser-dados';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

describe('NearbyProfilesEffects', () => {
  let actions$: ReplaySubject<Action>;
  let effects: NearbyProfilesEffects;
  let store: MockStore;

  let svc: {
    getProfilesNearLocation: Mock;
  };

  let notify: {
    showError: Mock;
  };

  let globalErr: {
    handleError: Mock;
  };

  const uid = 'u-1';
  const lat = -23.55;
  const lon = -46.63;
  const radiusKm = 10;
  const params = { uid, lat, lon, radiusKm };
  const key = buildNearbyKey(params);

  function setNearbyState(state: NearbyProfilesState): void {
    store.setState({ nearbyProfiles: state });
    store.refreshState();
  }

  beforeEach(() => {
    actions$ = new ReplaySubject<Action>(1);

    svc = {
      getProfilesNearLocation: vi.fn(() => Promise.resolve([])),
    };

    notify = {
      showError: vi.fn(),
    };

    globalErr = {
      handleError: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        NearbyProfilesEffects,
        provideMockActions(() => actions$),
        provideMockStore({
          initialState: {
            nearbyProfiles: initialNearbyProfilesState,
          },
        }),
        { provide: NearbyProfilesService, useValue: svc },
        { provide: ErrorNotificationService, useValue: notify },
        { provide: GlobalErrorHandlerService, useValue: globalErr },
      ],
    });

    effects = TestBed.inject(NearbyProfilesEffects);
    store = TestBed.inject(MockStore);
  });

  afterEach(() => {
    actions$.complete();
  });

  it('cache-first: quando isFresh=true emite loaded com a lista do cache sem chamar service', async () => {
    const cached: NearbyEntry = {
      list: [{ uid: 'a' } as IUserDados],
      loading: false,
      error: null,
      updatedAt: Date.now(),
    };

    setNearbyState({
      byKey: { [key]: cached },
      ttlMs: 120_000,
    });

    actions$.next(NearbyProfilesActions.load({ params }));

    const emitted = await firstValueFrom(effects.load$);

    expect(emitted).toEqual(
      NearbyProfilesActions.loaded({
        key,
        list: cached.list,
        updatedAt: expect.any(Number) as any,
      })
    );
    expect(svc.getProfilesNearLocation).not.toHaveBeenCalled();
  });

  it('fetch: quando isFresh=false chama service e emite loaded com a nova lista', async () => {
    const fetched: IUserDados[] = [
      { uid: 'x' } as IUserDados,
      { uid: 'y' } as IUserDados,
    ];

    setNearbyState({
      byKey: {
        [key]: { list: [], loading: false, error: null, updatedAt: 0 },
      },
      ttlMs: 120_000,
    });

    svc.getProfilesNearLocation.mockResolvedValue(fetched);

    actions$.next(NearbyProfilesActions.load({ params }));

    const emitted = await firstValueFrom(effects.load$);

    expect(svc.getProfilesNearLocation).toHaveBeenCalledOnce();
    expect(svc.getProfilesNearLocation).toHaveBeenCalledWith(lat, lon, radiusKm, uid);
    expect(emitted).toEqual(
      NearbyProfilesActions.loaded({
        key,
        list: fetched,
        updatedAt: expect.any(Number) as any,
      })
    );
  });

  it('erro: quando service rejeita, emite error e notifica/handleError', async () => {
    setNearbyState({
      byKey: {
        [key]: { list: [], loading: false, error: null, updatedAt: 0 },
      },
      ttlMs: 120_000,
    });

    const boom = new Error('network');
    svc.getProfilesNearLocation.mockRejectedValue(boom);

    actions$.next(NearbyProfilesActions.load({ params }));

    const emitted = await firstValueFrom(effects.load$);

    expect(emitted).toEqual(
      NearbyProfilesActions.error({
        key,
        message: 'Erro ao carregar perfis próximos.',
      })
    );
    expect(notify.showError).toHaveBeenCalledWith('Erro ao carregar perfis próximos.');
    expect(globalErr.handleError).toHaveBeenCalledWith(boom);
  });
});
