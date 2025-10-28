//src/app/store/reducers/reducers.location/location.reducer.spec.ts
import { locationReducer } from './location.reducer';
import * as LocationActions from '../../actions/actions.location/location.actions';
import { LocationState, initialLocationState } from '../../states/states.location/location.state';

describe('LocationReducer', () => {
  it('deve retornar o estado inicial para uma action desconhecida', () => {
    const action = { type: '@@init/unknown' } as any;
    const state = locationReducer(undefined, action);
    expect(state).toEqual(initialLocationState);
  });

  it('deve atualizar currentLocation com updateCurrentLocation (imutável)', () => {
    const prev: LocationState = {
      currentLocation: null,
      searchParams: { maxDistanceKm: 10 },
    };

    const action = LocationActions.updateCurrentLocation({ latitude: 1.234, longitude: 5.678 });
    const next = locationReducer(prev, action);

    expect(next).not.toBe(prev); // imutabilidade do objeto raiz
    expect(next.currentLocation).toEqual({ latitude: 1.234, longitude: 5.678 });
    expect(next.searchParams).toBe(prev.searchParams); // searchParams não deve ser recriado
  });

  it('deve atualizar searchParams.maxDistanceKm com setMaxDistance (imutável)', () => {
    const prev: LocationState = {
      currentLocation: { latitude: 9.9, longitude: 8.8 },
      searchParams: { maxDistanceKm: 10 },
    };

    const action = LocationActions.setMaxDistance({ maxDistanceKm: 25 });
    const next = locationReducer(prev, action);

    expect(next).not.toBe(prev);
    expect(next.currentLocation).toBe(prev.currentLocation); // currentLocation preservado (referência)
    expect(next.searchParams).not.toBe(prev.searchParams);   // novo objeto (imutabilidade)
    expect(next.searchParams.maxDistanceKm).toBe(25);
  });

  it('deve permitir encadear updateCurrentLocation -> setMaxDistance mantendo imutabilidade correta', () => {
    const s1 = locationReducer(undefined, { type: '@@init' } as any);

    const s2 = locationReducer(s1, LocationActions.updateCurrentLocation({
      latitude: -23.55, longitude: -46.63
    }));
    expect(s2.currentLocation).toEqual({ latitude: -23.55, longitude: -46.63 });
    expect(s2.searchParams).toBe(s1.searchParams);

    const s3 = locationReducer(s2, LocationActions.setMaxDistance({ maxDistanceKm: 42 }));
    expect(s3.searchParams.maxDistanceKm).toBe(42);
    expect(s3.currentLocation).toBe(s2.currentLocation);

    // garantindo que cada passo cria um novo objeto raiz
    expect(s2).not.toBe(s1);
    expect(s3).not.toBe(s2);
  });
});
