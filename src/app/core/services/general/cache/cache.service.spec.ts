import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CacheService } from './cache.service';
import { CachePersistenceService } from './cache-persistence.service';
import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from '../../privacy/privacy-debug-logger.service';

describe('CacheService', () => {
  let service: CacheService;
  let persistence: {
    getPersistent: ReturnType<typeof vi.fn>;
    setPersistent: ReturnType<typeof vi.fn>;
    deletePersistent: ReturnType<typeof vi.fn>;
    deletePersistentByPrefixes: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    localStorage.clear();

    persistence = {
      getPersistent: vi.fn().mockReturnValue(of(null)),
      setPersistent: vi.fn().mockReturnValue(of(void 0)),
      deletePersistent: vi.fn().mockReturnValue(of(void 0)),
      deletePersistentByPrefixes: vi.fn().mockReturnValue(of(0)),
    };

    TestBed.configureTestingModule({
      providers: [
        CacheService,
        {
          provide: CachePersistenceService,
          useValue: persistence,
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: { handleError: vi.fn() },
        },
        {
          provide: PrivacyDebugLoggerService,
          useValue: {
            canLog: vi.fn(() => false),
            log: vi.fn(),
          },
        },
      ],
    });

    service = TestBed.inject(CacheService);
    vi.clearAllMocks();
  });

  it('deve ser criado sem Store NgRx', () => {
    expect(service).toBeTruthy();
  });

  it('mantém set() em memória por padrão', async () => {
    service.set('catalog:runtime', { value: 1 });

    expect(
      await firstValueFrom(
        service.get<{ value: number }>('catalog:runtime')
      )
    ).toEqual({ value: 1 });
    expect(persistence.setPersistent).not.toHaveBeenCalled();
  });

  it('persiste somente quando opts.persist é explicitamente true', () => {
    service.set(
      'catalog:approved',
      [{ id: 1 }],
      60_000,
      { persist: true }
    );

    expect(persistence.setPersistent).toHaveBeenCalledWith(
      'catalog:approved',
      [{ id: 1 }]
    );
  });

  it('recusa persistência explícita de chave privada conhecida', () => {
    service.set(
      'user:uid-1',
      { uid: 'uid-1', email: 'private@example.com' },
      60_000,
      { persist: true }
    );

    expect(persistence.setPersistent).not.toHaveBeenCalled();
    expect(service.has('user:uid-1')).toBe(true);
  });

  it('rehidrata apenas valor legado permitido retornado pelo adaptador', async () => {
    persistence.getPersistent.mockReturnValueOnce(
      of([{ id: 33, sigla: 'RJ' }])
    );

    expect(
      await firstValueFrom(
        service.get('catalog:legacy-public')
      )
    ).toEqual([{ id: 33, sigla: 'RJ' }]);
    expect(service.has('catalog:legacy-public')).toBe(true);
  });

  it('getSync lê qualquer chave da memória', () => {
    service.set('uiDistanceKm', 15, 60_000);

    expect(service.getSync<number>('uiDistanceKm')).toBe(15);
  });

  it('getSync não lê objeto arbitrário do localStorage', () => {
    localStorage.setItem(
      'currentUser',
      JSON.stringify({ uid: 'uid-1', email: 'private@example.com' })
    );
    localStorage.setItem('uiDistanceKm', JSON.stringify(20));

    expect(service.getSync('currentUser')).toBeNull();
    expect(service.getSync('uiDistanceKm')).toBeNull();
  });

  it('mantém somente currentUserUid como fallback síncrono', () => {
    service.set('currentUserUid', 'uid-1', undefined, {
      persist: false,
    });

    expect(localStorage.getItem('currentUserUid')).toBe(
      JSON.stringify('uid-1')
    );

    service.clear();

    expect(service.getSync<string>('currentUserUid')).toBe('uid-1');
  });

  it('setUser mantém perfil em memória e não persiste currentUser', () => {
    service.setUser('uid-1', {
      uid: 'uid-1',
      email: 'private@example.com',
    } as any);

    expect(service.getSync('user:uid-1')).toEqual({
      uid: 'uid-1',
      email: 'private@example.com',
    });
    expect(localStorage.getItem('currentUser')).toBeNull();
    expect(persistence.setPersistent).not.toHaveBeenCalled();
  });

  it('syncCurrentUserWithUid preserva API sem espelhar perfil completo', () => {
    service.syncCurrentUserWithUid({
      uid: 'uid-2',
      email: 'private@example.com',
    } as any);

    expect(service.getSync('user:uid-2')).toEqual({
      uid: 'uid-2',
      email: 'private@example.com',
    });
    expect(service.getSync('currentUser')).toBeNull();
    expect(service.getSync<string>('currentUserUid')).toBe('uid-2');
    expect(localStorage.getItem('currentUser')).toBeNull();
  });

  it('remove item expirado da memória', () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_000);
    service.set('short-lived', true, 10);

    vi.spyOn(Date, 'now').mockReturnValue(2_000);

    expect(service.has('short-lived')).toBe(false);
    expect(service.getSync('short-lived')).toBeNull();
  });

  it('clearSensitiveSessionCache$ remove memória, localStorage e prefixos persistidos', async () => {
    service.set('user:uid-1', { uid: 'uid-1' });
    service.set('currentUserUid', 'uid-1');
    service.set('catalog:public', { id: 1 });

    await firstValueFrom(service.clearSensitiveSessionCache$());

    expect(service.has('user:uid-1')).toBe(false);
    expect(service.has('catalog:public')).toBe(true);
    expect(localStorage.getItem('currentUserUid')).toBeNull();
    expect(
      persistence.deletePersistentByPrefixes
    ).toHaveBeenCalledWith(
      expect.arrayContaining([
        'user:',
        'discovery:',
        'preferences:',
      ])
    );
  });

  it('markAsNotFound mantém marcador somente em memória', () => {
    service.markAsNotFound('profile:uid-1');

    expect(service.isNotFound('profile:uid-1')).toBe(true);
    expect(persistence.setPersistent).not.toHaveBeenCalled();
  });
});
