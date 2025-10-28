//src/app/store/reducers/reducers.location/nearby-profiles.reducer.spec.ts
import { nearbyProfilesReducer } from './nearby-profiles.reducer';
import { NearbyProfilesActions } from '../../actions/actions.location/nearby-profiles.actions';
import { NearbyProfilesState, buildNearbyKey } from '../../states/states.location/nearby-profiles.state';
import { IUserDados } from '../../../core/interfaces/iuser-dados';

describe('nearbyProfilesReducer', () => {
  const uid = 'u-1';
  const lat = -23.55;
  const lon = -46.63;
  const radiusKm = 10;
  const params = { uid, lat, lon, radiusKm };
  const key = buildNearbyKey(params);

  it('should return initial state for unknown action', () => {
    const state = nearbyProfilesReducer(undefined, { type: '@@init/unknown' } as any);
    // shape básico esperado
    expect(state).toEqual(jasmine.objectContaining({
      ttlMs: jasmine.any(Number),
      byKey: {},
    }));
  });

  it('load: deve setar loading=true e limpar error para a key', () => {
    const prev: NearbyProfilesState = {
      ttlMs: 60000,
      byKey: {},
    };

    const next = nearbyProfilesReducer(prev, NearbyProfilesActions.load({ params }));

    expect(next).not.toBe(prev);
    expect(next.byKey[key]).toBeDefined();
    expect(next.byKey[key].loading).toBeTrue();
    expect(next.byKey[key].error).toBeNull();
    // não deve apagar lista existente se já houver (aqui não havia)
    expect(next.byKey[key].list).toEqual([]);
  });

  it('loaded: deve preencher list, updatedAt e setar loading=false', () => {
    const prev: NearbyProfilesState = {
      ttlMs: 60000,
      byKey: {
        [key]: { list: [], loading: true, error: null, updatedAt: 0 },
      },
    };

    const list: IUserDados[] = [{ uid: 'a' } as IUserDados, { uid: 'b' } as IUserDados];
    const updatedAt = Date.now();

    const next = nearbyProfilesReducer(prev, NearbyProfilesActions.loaded({ key, list, updatedAt }));

    expect(next).not.toBe(prev);
    expect(next.byKey[key].loading).toBeFalse();
    expect(next.byKey[key].error).toBeNull();
    expect(next.byKey[key].list).toEqual(list);
    expect(next.byKey[key].updatedAt).toBe(updatedAt);
  });

  it('error: deve setar error e loading=false preservando lista', () => {
    const prev: NearbyProfilesState = {
      ttlMs: 60000,
      byKey: {
        [key]: { list: [{ uid: 'x' } as IUserDados], loading: true, error: null, updatedAt: 123 },
      },
    };

    const next = nearbyProfilesReducer(prev, NearbyProfilesActions.error({ key, message: 'Falha' }));

    expect(next.byKey[key].loading).toBeFalse();
    expect(next.byKey[key].error).toBe('Falha');
    expect(next.byKey[key].list).toEqual(prev.byKey[key].list);
    expect(next.byKey[key].updatedAt).toBe(123);
  });

  it('invalidate (com key): deve zerar updatedAt apenas da key informada', () => {
    const key2 = buildNearbyKey({ uid, lat, lon, radiusKm: 20 });
    const prev: NearbyProfilesState = {
      ttlMs: 60000,
      byKey: {
        [key]: { list: [], loading: false, error: null, updatedAt: 111 },
        [key2]: { list: [], loading: false, error: null, updatedAt: 222 },
      },
    };

    const next = nearbyProfilesReducer(prev, NearbyProfilesActions.invalidate({ key }));

    expect(next.byKey[key].updatedAt).toBe(0);
    expect(next.byKey[key2].updatedAt).toBe(222);
  });

  it('invalidate (sem key): deve zerar updatedAt de todas as entries', () => {
    const prev: NearbyProfilesState = {
      ttlMs: 60000,
      byKey: {
        [key]: { list: [], loading: false, error: null, updatedAt: 111 },
        ['k2']: { list: [], loading: false, error: null, updatedAt: 222 },
      },
    };

    const next = nearbyProfilesReducer(prev, NearbyProfilesActions.invalidate({}));

    expect(next.byKey[key].updatedAt).toBe(0);
    expect(next.byKey['k2'].updatedAt).toBe(0);
  });
});
