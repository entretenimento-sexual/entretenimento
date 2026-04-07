//src/app/store/selectors/selectors.location/location.selectors.spec.ts
import { selectLocationNearbyVMByUid } from './location.selectors';
import {
  NearbyProfilesState,
  NearbyEntry,
  buildNearbyKey,
} from '../../states/states.location/nearby-profiles.state';
import { IUserDados } from '../../../core/interfaces/iuser-dados';

describe('selectLocationNearbyVMByUid', () => {
  const uid = 'user-123';
  const lat = -23.5505;
  const lon = -46.6333;
  const radiusKm = 10;

  const params = { uid, lat, lon, radiusKm };
  const key = buildNearbyKey(params);

  const currentLocation = { latitude: lat, longitude: lon };
  const maxDistanceKm = radiusKm;

  const mkNearbyState = (entry?: Partial<NearbyEntry>, ttlMs = 120_000): NearbyProfilesState => ({
    ttlMs,
    byKey: {
      [key]: {
        list: [],
        loading: false,
        error: null,
        updatedAt: 0,
        ...entry,
      } as NearbyEntry,
    },
  });

  it('retorna VM “vazia” quando não há localização', () => {
    const sel = selectLocationNearbyVMByUid(uid);
    const nearbyState = mkNearbyState({}, 120_000);
    const ttl = nearbyState.ttlMs;

    const vm = sel.projector(
      null,              // currentLocation ausente
      maxDistanceKm,
      nearbyState,
      ttl
    );

    expect(vm.key).toBeNull();
    expect(vm.currentLocation).toBeNull();
    expect(vm.maxDistanceKm).toBe(maxDistanceKm);
    expect(vm.list.length).toBe(0);
    expect(vm.loading).toBe(false);
    expect(vm.error).toBeNull();
    expect(vm.isFresh).toBe(false);
    expect(vm.ttlMs).toBe(ttl);
    expect(vm.ttlLeftMs).toBe(0);
  });

  it('indica cache fresco (isFresh=true) quando updatedAt está dentro do TTL', () => {
    const ttl = 60_000; // 1 min
    const now = Date.now();
    const updatedAt = now - (ttl - 1_000); // faltam ~1s

    const nearbyState = mkNearbyState({ updatedAt, list: [{ uid: 'a' } as IUserDados] }, ttl);
    const sel = selectLocationNearbyVMByUid(uid);

    const vm = sel.projector(
      currentLocation,
      maxDistanceKm,
      nearbyState,
      ttl
    );

    expect(vm.key).toBe(key);
    expect(vm.currentLocation).toEqual(currentLocation);
    expect(vm.list.length).toBe(1);
    expect(vm.loading).toBe(false);
    expect(vm.error).toBeNull();
    expect(vm.isFresh).toBe(true);
    expect(vm.ttlMs).toBe(ttl);
    // deve restar tempo (>0) e não extrapolar TTL
    expect(vm.ttlLeftMs).toBeGreaterThan(0);
    expect(vm.ttlLeftMs).toBeLessThanOrEqual(ttl);
  });

  it('indica cache vencido (isFresh=false) e ttlLeftMs=0 quando updatedAt ultrapassa TTL', () => {
    const ttl = 30_000; // 30s
    const now = Date.now();
    const updatedAt = now - (ttl + 5_000); // venceu há 5s

    const nearbyState = mkNearbyState({ updatedAt, list: [{ uid: 'b' } as IUserDados] }, ttl);
    const sel = selectLocationNearbyVMByUid(uid);

    const vm = sel.projector(
      currentLocation,
      maxDistanceKm,
      nearbyState,
      ttl
    );

    expect(vm.key).toBe(key);
    expect(vm.isFresh).toBe(false);
    expect(vm.ttlMs).toBe(ttl);
    expect(vm.ttlLeftMs).toBe(0);
    // lista continua presente até o efeito recarregar
    expect(vm.list.length).toBe(1);
  });

  it('usa entry default quando a key não existe no byKey', () => {
    // estado sem a chave => selector deve usar { list: [], loading: false, error: null, updatedAt: 0 }
    const ttl = 45_000;
    const nearbyState: NearbyProfilesState = {
      ttlMs: ttl,
      byKey: {}, // 👈 sem a key
    };
    const sel = selectLocationNearbyVMByUid(uid);

    const vm = sel.projector(
      currentLocation,
      maxDistanceKm,
      nearbyState,
      ttl
    );

    expect(vm.key).toBe(buildNearbyKey({ uid, lat, lon, radiusKm }));
    expect(vm.list.length).toBe(0);
    expect(vm.loading).toBe(false);
    expect(vm.error).toBeNull();
    expect(vm.isFresh).toBe(false);
    expect(vm.ttlLeftMs).toBe(0);
  });
});
