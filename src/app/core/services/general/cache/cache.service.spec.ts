import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, Subject } from 'rxjs';
import { afterEach, vi } from 'vitest';

import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from '../../privacy/privacy-debug-logger.service';
import {
  createStoreTestingMock,
  provideStoreTestingMock,
} from '../../../../../test/ngrx-store-testing.providers';
import {
  CachePersistentEnvelope,
  CachePersistenceService,
} from './cache-persistence.service';
import { CacheService } from './cache.service';

describe('CacheService', () => {
  let service: CacheService;

  const getPersistentEntry = vi.fn(() => of(null));
  const setPersistentEntry = vi.fn(() => of(void 0));
  const deletePersistent = vi.fn(() => of(void 0));
  const deletePersistentMany = vi.fn(() => of(0));
  const deletePersistentByPrefix = vi.fn(() => of(0));
  const handleError = vi.fn();
  const log = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    const storeMock = createStoreTestingMock({
      defaultSelectorValue: null,
    });

    TestBed.configureTestingModule({
      providers: [
        ...provideStoreTestingMock(storeMock),
        {
          provide: CachePersistenceService,
          useValue: {
            getPersistentEntry,
            setPersistentEntry,
            deletePersistent,
            deletePersistentMany,
            deletePersistentByPrefix,
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

  it('persiste a expiração absoluta calculada pelo TTL', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);

    service.set('profile:user-1', { nickname: 'perfil' }, 5_000);

    expect(setPersistentEntry).toHaveBeenCalledWith(
      'profile:user-1',
      { nickname: 'perfil' },
      6_000
    );
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
    vi.spyOn(Date, 'now').mockReturnValue(1_000);

    await expect(
      firstValueFrom(service.get<{ value: string }>('cache:item'))
    ).resolves.toEqual({ value: 'cached' });
    expect(service.has('cache:item')).toBe(true);

    vi.spyOn(Date, 'now').mockReturnValue(2_001);
    expect(service.has('cache:item')).toBe(false);
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
