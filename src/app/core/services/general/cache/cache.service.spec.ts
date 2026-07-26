import { TestBed } from '@angular/core/testing';
import { firstValueFrom, Observable, of, Subject } from 'rxjs';
import { afterEach, vi } from 'vitest';

import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from '../../privacy/privacy-debug-logger.service';
import { CACHE_MAINTENANCE_AUTO_START } from './cache-maintenance.service';
import {
  CachePersistentEnvelope,
  CachePersistenceService,
} from './cache-persistence.service';
import {
  CACHE_MEMORY_MAX_ENTRIES,
  CacheService,
} from './cache.service';

describe('CacheService', () => {
  let service: CacheService;

  const getPersistentEntry = vi.fn(
    (): Observable<CachePersistentEnvelope<unknown> | null> => of(null)
  );
  const setPersistentEntry = vi.fn(() => of(void 0));
  const deletePersistent = vi.fn(() => of(void 0));
  const deletePersistentMany = vi.fn(() => of(0));
  const deletePersistentByPrefix = vi.fn(() => of(0));
  const cleanupExpiredEntries = vi.fn(() =>
    of({
      totalKeys: 0,
      scanned: 0,
      removed: 0,
      invalid: 0,
      expired: 0,
      nextCursor: 0,
    })
  );
  const handleError = vi.fn();
  const log = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    TestBed.configureTestingModule({
      providers: [
        {
          provide: CACHE_MEMORY_MAX_ENTRIES,
          useValue: 3,
        },
        {
          provide: CACHE_MAINTENANCE_AUTO_START,
          useValue: false,
        },
        {
          provide: CachePersistenceService,
          useValue: {
            getPersistentEntry,
            setPersistentEntry,
            deletePersistent,
            deletePersistentMany,
            deletePersistentByPrefix,
            cleanupExpiredEntries,
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError,
          },
        },
        {
          provide: PrivacyDebugLoggerService,
          useValue: {
            canLog: () => false,
            log,
          },
        },
      ],
    });

    service = TestBed.inject(CacheService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('retorna null quando memória e IndexedDB não possuem a chave', async () => {
    await expect(
      firstValueFrom(service.get('cache:missing'))
    ).resolves.toBeNull();

    expect(getPersistentEntry).toHaveBeenCalledWith('cache:missing');
    expect(service.metricsSnapshot().misses).toBe(1);
  });

  it('persiste a expiração absoluta calculada pelo TTL explícito', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);

    service.set('profile:user-1', { nickname: 'perfil' }, 5_000);

    expect(setPersistentEntry).toHaveBeenCalledWith(
      'profile:user-1',
      { nickname: 'perfil' },
      6_000
    );
  });

  it('aplica política de busca somente quando TTL e persistência são omitidos', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000);

    service.set('search:user-1:term', ['user-2']);

    expect(setPersistentEntry).not.toHaveBeenCalled();
    expect(service.has('search:user-1:term')).toBe(true);

    nowSpy.mockReturnValue(301_001);
    expect(service.has('search:user-1:term')).toBe(false);
  });

  it('reidrata a memória usando a expiração original do IndexedDB', async () => {
    const entry: CachePersistentEnvelope<{ value: string }> = {
      schemaVersion: 2,
      value: { value: 'cached' },
      createdAt: 500,
      updatedAt: 500,
      expiresAt: 2_000,
      writeVersion: 1,
    };

    getPersistentEntry.mockReturnValueOnce(of(entry));
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000);

    await expect(
      firstValueFrom(service.get<{ value: string }>('cache:item'))
    ).resolves.toEqual({ value: 'cached' });
    expect(service.has('cache:item')).toBe(true);
    expect(service.metricsSnapshot().indexedDbHits).toBe(1);
    expect(service.metricsSnapshot().rehydrationCount).toBe(1);

    nowSpy.mockReturnValue(2_001);
    expect(service.has('cache:item')).toBe(false);
  });

  it('registra hit em memória sem armazenar chaves nas métricas', async () => {
    service.set('cache:metric', { enabled: true }, undefined, { persist: false });

    await expect(firstValueFrom(service.get('cache:metric'))).resolves.toEqual({
      enabled: true,
    });

    const metrics = service.metricsSnapshot();
    expect(metrics.memoryHits).toBe(1);
    expect(metrics.writes).toBe(1);
    expect(Object.keys(metrics)).not.toContain('keys');
  });

  it('não permite que leitura persistente antiga sobrescreva escrita nova', async () => {
    const persisted$ = new Subject<CachePersistentEnvelope<string> | null>();
    getPersistentEntry.mockReturnValueOnce(persisted$.asObservable());
    vi.spyOn(Date, 'now').mockReturnValue(1_000);

    const resultPromise = firstValueFrom(service.get<string>('cache:race'));

    service.set('cache:race', 'new-value', 10_000, { persist: false });

    persisted$.next({
      schemaVersion: 2,
      value: 'old-value',
      createdAt: 100,
      updatedAt: 100,
      expiresAt: 20_000,
      writeVersion: 1,
    });
    persisted$.complete();

    await expect(resultPromise).resolves.toBe('new-value');
    expect(service.getSync<string>('cache:race')).toBe('new-value');
  });

  it('mantém somente as entradas mais recentes na memória sem apagar o IndexedDB', () => {
    service.set('cache:a', 'a', undefined, { persist: false });
    service.set('cache:b', 'b', undefined, { persist: false });
    service.set('cache:c', 'c', undefined, { persist: false });

    expect(service.getSync('cache:a')).toBe('a');

    service.set('cache:d', 'd', undefined, { persist: false });

    expect(service.size()).toBe(3);
    expect(service.getSync('cache:a')).toBe('a');
    expect(service.getSync('cache:b')).toBeNull();
    expect(service.getSync('cache:c')).toBe('c');
    expect(service.getSync('cache:d')).toBe('d');
    expect(deletePersistent).not.toHaveBeenCalled();
    expect(service.metricsSnapshot().lruEvictions).toBe(1);
  });

  it('impede reidratação após delete e libera a revisão ao finalizar a leitura', async () => {
    const persisted$ = new Subject<CachePersistentEnvelope<string> | null>();
    getPersistentEntry.mockReturnValueOnce(persisted$.asObservable());

    const resultPromise = firstValueFrom(
      service.get<string>('cache:deleted-during-read')
    );

    service.delete('cache:deleted-during-read');

    persisted$.next({
      schemaVersion: 2,
      value: 'stale-value',
      createdAt: 100,
      updatedAt: 100,
      expiresAt: null,
      writeVersion: 1,
    });
    persisted$.complete();

    await expect(resultPromise).resolves.toBeNull();
    expect(service.getSync('cache:deleted-during-read')).toBeNull();
    expect(
      (service as unknown as { keyRevisions: Map<string, number> })
        .keyRevisions.size
    ).toBe(0);
  });

  it('limpa formatos privados atuais e legados ao encerrar a sessão', async () => {
    service.set('preferences:user-1', { genero: ['x'] }, 60_000, {
      persist: false,
    });
    service.set('friendSettings:user-1', { receiveRequests: true }, 60_000, {
      persist: false,
    });
    service.set('search:user-1:hash', [{ uid: 'user-2' }], 60_000, {
      persist: false,
    });

    await firstValueFrom(service.clearSensitiveSessionCache$());

    expect(service.has('preferences:user-1')).toBe(false);
    expect(service.has('friendSettings:user-1')).toBe(false);
    expect(service.has('search:user-1:hash')).toBe(false);

    expect(deletePersistentByPrefix).toHaveBeenCalledWith('preferences:');
    expect(deletePersistentByPrefix).toHaveBeenCalledWith('friendSettings:');
    expect(deletePersistentByPrefix).toHaveBeenCalledWith('search:');
    expect(deletePersistentMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        'friendSettings',
        'loadingSearch',
        'loadingSettings',
      ])
    );
  });
});
