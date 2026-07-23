import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';
import { vi } from 'vitest';

import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { CacheAuthLifecycleBridgeService } from './cache-auth-lifecycle-bridge.service';
import { CacheSessionLifecycleService } from './cache-session-lifecycle.service';

describe('CacheAuthLifecycleBridgeService', () => {
  let service: CacheAuthLifecycleBridgeService;
  let uidSubject: BehaviorSubject<string | null>;
  let cacheLifecycle: {
    clearForUidTransition$: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    uidSubject = new BehaviorSubject<string | null>('uid-a');
    cacheLifecycle = {
      clearForUidTransition$: vi.fn().mockReturnValue(of(void 0)),
    };

    TestBed.configureTestingModule({
      providers: [
        CacheAuthLifecycleBridgeService,
        {
          provide: AuthSessionService,
          useValue: { uid$: uidSubject.asObservable() },
        },
        {
          provide: CacheSessionLifecycleService,
          useValue: cacheLifecycle,
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: { handleError: vi.fn() },
        },
      ],
    });

    service = TestBed.inject(CacheAuthLifecycleBridgeService);
  });

  it('na inicialização limpa somente resíduos session-scoped', () => {
    service.start();

    expect(cacheLifecycle.clearForUidTransition$).toHaveBeenCalledTimes(1);
    expect(cacheLifecycle.clearForUidTransition$).toHaveBeenCalledWith(null);
  });

  it('limpa o UID anterior em troca direta de conta', () => {
    service.start();
    uidSubject.next('uid-b');

    expect(cacheLifecycle.clearForUidTransition$).toHaveBeenNthCalledWith(
      2,
      'uid-a'
    );
  });

  it('limpa o UID anterior quando a sessão desaparece', () => {
    service.start();
    uidSubject.next(null);

    expect(cacheLifecycle.clearForUidTransition$).toHaveBeenNthCalledWith(
      2,
      'uid-a'
    );
  });

  it('não cria inscrições duplicadas quando start é chamado novamente', () => {
    service.start();
    service.start();
    uidSubject.next('uid-b');

    expect(cacheLifecycle.clearForUidTransition$).toHaveBeenCalledTimes(2);
  });
});
