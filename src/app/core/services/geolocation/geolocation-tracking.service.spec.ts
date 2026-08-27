import { of } from 'rxjs';
import { describe, beforeEach, afterEach, expect, it, vi } from 'vitest';

import { GeolocationTrackingService } from './geolocation-tracking.service';

describe('GeolocationTrackingService session isolation', () => {
  let successCallbacks: PositionCallback[];
  let errorCallbacks: PositionErrorCallback[];
  let clearWatch: ReturnType<typeof vi.fn>;
  let updateDocument: ReturnType<typeof vi.fn>;
  let service: GeolocationTrackingService;

  const position = (latitude = -22.9309, longitude = -43.3536): GeolocationPosition =>
    ({
      coords: {
        latitude,
        longitude,
        accuracy: 25,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp: Date.now(),
    }) as GeolocationPosition;

  beforeEach(() => {
    localStorage.clear();
    successCallbacks = [];
    errorCallbacks = [];
    clearWatch = vi.fn();
    updateDocument = vi.fn(() => of(void 0));

    let nextWatchId = 1;
    const geolocation = {
      getCurrentPosition: vi.fn(),
      watchPosition: vi.fn(
        (success: PositionCallback, error?: PositionErrorCallback | null) => {
          successCallbacks.push(success);
          if (error) errorCallbacks.push(error);
          return nextWatchId++;
        }
      ),
      clearWatch: clearWatch as unknown as Geolocation['clearWatch'],
    } satisfies Partial<Geolocation>;

    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: geolocation,
    });

    service = new GeolocationTrackingService(
      { runOutsideAngular: (fn: () => void) => fn() } as any,
      { updateDocument } as any,
      { handleError: vi.fn() } as any,
      { showError: vi.fn() } as any,
    );
  });

  afterEach(() => {
    service.stopTracking({ clearCachedLocation: true });
    vi.restoreAllMocks();
  });

  it('substitui o watcher ao trocar de UID e grava somente na nova sessão', () => {
    service.startTracking('user-a');
    service.startTracking('user-b');

    expect(clearWatch).toHaveBeenCalledWith(1);
    expect(successCallbacks).toHaveLength(2);

    // Um callback antigo já enfileirado não pode escrever no UID anterior.
    successCallbacks[0](position());
    expect(updateDocument).not.toHaveBeenCalled();

    successCallbacks[1](position());

    expect(updateDocument).toHaveBeenCalledTimes(1);
    expect(updateDocument).toHaveBeenCalledWith(
      'users',
      'user-b',
      expect.objectContaining({
        latitude: -22.9309,
        longitude: -43.3536,
      }),
      expect.objectContaining({
        context: 'GeolocationTrackingService.persistLocation$',
      })
    );

    const cached = JSON.parse(localStorage.getItem('geo:last') ?? '{}');
    expect(cached.uid).toBe('user-b');
    expect(service.getLastSnapshot()).toEqual(
      expect.objectContaining({ latitude: -22.9309, longitude: -43.3536 })
    );
  });

  it('não expõe snapshot de uma sessão diferente', () => {
    localStorage.setItem(
      'geo:last',
      JSON.stringify({
        uid: 'user-a',
        coords: { latitude: -22.9, longitude: -43.3, accuracy: 30 },
        timestamp: Date.now(),
      })
    );

    service.startTracking('user-b');

    expect(service.getLastSnapshot()).toBeNull();
  });

  it('emite a posição do viewer reativamente e limpa ao encerrar tracking', () => {
    const snapshots: unknown[] = [];
    const subscription = service.snapshot$.subscribe((snapshot) => {
      snapshots.push(snapshot);
    });

    service.startTracking('user-a');
    successCallbacks[0](position(-22.91, -43.31));

    expect(snapshots.at(-1)).toEqual(
      expect.objectContaining({ latitude: -22.91, longitude: -43.31 })
    );

    service.stopTracking({ clearCachedLocation: true });
    expect(snapshots.at(-1)).toBeNull();

    subscription.unsubscribe();
  });

  it('remove watcher e snapshot sensível ao encerrar a sessão', () => {
    service.startTracking('user-a');
    successCallbacks[0](position());

    expect(localStorage.getItem('geo:last')).not.toBeNull();

    service.stopTracking({ clearCachedLocation: true });

    expect(clearWatch).toHaveBeenCalledWith(1);
    expect(localStorage.getItem('geo:last')).toBeNull();
    expect(service.getLastSnapshot()).toBeNull();
  });
});