//src/app/store/effects/effects.location/nearby-profiles.effects.spec.ts
import { TestBed } from '@angular/core/testing';
import { ReplaySubject, firstValueFrom } from 'rxjs';
import { Action } from '@ngrx/store';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';

import { NearbyProfilesEffects } from './nearby-profiles.effects';
import { NearbyProfilesActions } from '../../actions/actions.location/nearby-profiles.actions';
import { selectEntryByKey, selectNearbyFreshByParams } from '../../selectors/selectors.location/nearby-profiles.selectors';
import { buildNearbyKey, NearbyEntry } from '../../states/states.location/nearby-profiles.state';

import { NearbyProfilesService } from '../../../core/services/geolocation/near-profile.service';
import { ErrorNotificationService } from '../../../core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../../core/services/error-handler/global-error-handler.service';
import { IUserDados } from '../../../core/interfaces/iuser-dados';

describe('NearbyProfilesEffects', () => {
  let actions$: ReplaySubject<Action>;
  let effects: NearbyProfilesEffects;
  let store: MockStore;

  // stubs / spies
  let svc: jasmine.SpyObj<NearbyProfilesService>;
  let notify: jasmine.SpyObj<ErrorNotificationService>;
  let globalErr: jasmine.SpyObj<GlobalErrorHandlerService>;

  // params base
  const uid = 'u-1';
  const lat = -23.55;
  const lon = -46.63;
  const radiusKm = 10;
  const params = { uid, lat, lon, radiusKm };
  const key = buildNearbyKey(params);

  // selectors (factories → precisamos instanciar)
  const freshSel = selectNearbyFreshByParams(params);
  const entrySel = selectEntryByKey(key);

  beforeEach(() => {
    actions$ = new ReplaySubject<Action>(1);

    svc = jasmine.createSpyObj('NearbyProfilesService', ['getProfilesNearLocation']);
    notify = jasmine.createSpyObj('ErrorNotificationService', ['showError']);
    globalErr = jasmine.createSpyObj('GlobalErrorHandlerService', ['handleError']);

    TestBed.configureTestingModule({
      providers: [
        NearbyProfilesEffects,
        provideMockActions(() => actions$),
        provideMockStore(),
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

  it('cache-first: quando isFresh=true emite loaded com a lista do cache (sem chamar service)', async () => {
    const cached: NearbyEntry = {
      list: [{ uid: 'a' } as IUserDados],
      loading: false,
      error: null,
      updatedAt: Date.now(),
    };

    store.overrideSelector(freshSel, true);
    store.overrideSelector(entrySel, cached);

    actions$.next(NearbyProfilesActions.load({ params }));

    const emitted = await firstValueFrom(effects.load$);

    expect(emitted).toEqual(
      NearbyProfilesActions.loaded({
        key,
        list: cached.list,
        updatedAt: jasmine.any(Number) as any,
      })
    );
    expect(svc.getProfilesNearLocation).not.toHaveBeenCalled();
  });

  it('fetch: quando isFresh=false chama service e emite loaded com a nova lista', async () => {
    const fetched: IUserDados[] = [
      { uid: 'x' } as IUserDados,
      { uid: 'y' } as IUserDados,
    ];

    store.overrideSelector(freshSel, false);
    store.overrideSelector(entrySel, { list: [], loading: false, error: null, updatedAt: 0 });

    svc.getProfilesNearLocation.and.resolveTo(fetched);

    actions$.next(NearbyProfilesActions.load({ params }));

    const emitted = await firstValueFrom(effects.load$);

    expect(svc.getProfilesNearLocation).toHaveBeenCalledOnceWith(lat, lon, radiusKm, uid);
    expect(emitted).toEqual(
      NearbyProfilesActions.loaded({
        key,
        list: fetched,
        updatedAt: jasmine.any(Number) as any,
      })
    );
  });

  it('erro: quando service rejeita, emite error e notifica/handleError', async () => {
    store.overrideSelector(freshSel, false);
    store.overrideSelector(entrySel, { list: [], loading: false, error: null, updatedAt: 0 });

    const boom = new Error('network');
    svc.getProfilesNearLocation.and.rejectWith(boom);

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
