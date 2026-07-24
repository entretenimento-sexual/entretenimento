import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { AppCacheService } from './app-cache.service';
import { CacheService } from './cache.service';
import { CacheSessionLifecycleService } from './cache-session-lifecycle.service';

describe('CacheSessionLifecycleService', () => {
  let service: CacheSessionLifecycleService;
  let legacyCache: {
    clearSensitiveSessionCache$: ReturnType<typeof vi.fn>;
  };
  let appCache: {
    clearSessionScope$: ReturnType<typeof vi.fn>;
    clearUserScope$: ReturnType<typeof vi.fn>;
  };
  let globalError: {
    handleError: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    legacyCache = {
      clearSensitiveSessionCache$: vi.fn().mockReturnValue(of(void 0)),
    };
    appCache = {
      clearSessionScope$: vi.fn().mockReturnValue(of(void 0)),
      clearUserScope$: vi.fn().mockReturnValue(of(void 0)),
    };
    globalError = {
      handleError: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        CacheSessionLifecycleService,
        { provide: CacheService, useValue: legacyCache },
        { provide: AppCacheService, useValue: appCache },
        { provide: GlobalErrorHandlerService, useValue: globalError },
      ],
    });

    service = TestBed.inject(CacheSessionLifecycleService);
  });

  it('limpa cache legado, session scope e user scope no logout', async () => {
    await firstValueFrom(service.clearAfterLogout$(' uid-1 '));

    expect(legacyCache.clearSensitiveSessionCache$).toHaveBeenCalledTimes(1);
    expect(appCache.clearSessionScope$).toHaveBeenCalledTimes(1);
    expect(appCache.clearUserScope$).toHaveBeenCalledWith('uid-1');
  });

  it('não inventa user scope quando o UID do logout é desconhecido', async () => {
    await firstValueFrom(service.clearAfterLogout$(null));

    expect(legacyCache.clearSensitiveSessionCache$).toHaveBeenCalledTimes(1);
    expect(appCache.clearSessionScope$).toHaveBeenCalledTimes(1);
    expect(appCache.clearUserScope$).not.toHaveBeenCalled();
  });

  it('em primeira sessão limpa apenas o escopo session da nova fachada', async () => {
    await firstValueFrom(service.clearForUidTransition$(null));

    expect(appCache.clearSessionScope$).toHaveBeenCalledTimes(1);
    expect(appCache.clearUserScope$).not.toHaveBeenCalled();
    expect(legacyCache.clearSensitiveSessionCache$).not.toHaveBeenCalled();
  });

  it('em troca de conta limpa o UID anterior e o legado sensível', async () => {
    await firstValueFrom(service.clearForUidTransition$('uid-antigo'));

    expect(appCache.clearSessionScope$).toHaveBeenCalledTimes(1);
    expect(appCache.clearUserScope$).toHaveBeenCalledWith('uid-antigo');
    expect(legacyCache.clearSensitiveSessionCache$).toHaveBeenCalledTimes(1);
  });

  it('mantém a limpeza best-effort e envia falha ao handler global', async () => {
    appCache.clearSessionScope$.mockReturnValue(
      throwError(() => new Error('storage unavailable'))
    );

    await expect(
      firstValueFrom(service.clearAfterLogout$('uid-1'))
    ).resolves.toBeUndefined();

    expect(globalError.handleError).toHaveBeenCalledTimes(1);
  });
});
