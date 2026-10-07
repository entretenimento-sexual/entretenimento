import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter, type GuardResult } from '@angular/router';
import { BehaviorSubject, firstValueFrom, type Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplicationErrorService } from '../../services/error-handler/application-error.service';
import { ErrorNotificationService } from '../../services/error-handler/error-notification.service';
import { AuthSessionService } from '../../services/autentication/auth/auth-session.service';
import { authGuard } from './auth.guard';
import { authOnlyGuard } from './auth-only.guard';

describe('auth guards - single operational session authority', () => {
  let ready$: BehaviorSubject<boolean>;
  let uid$: BehaviorSubject<string | null>;
  let terminating$: BehaviorSubject<boolean>;
  let router: Router;

  beforeEach(() => {
    ready$ = new BehaviorSubject<boolean>(true);
    uid$ = new BehaviorSubject<string | null>('user-a');
    terminating$ = new BehaviorSubject<boolean>(false);

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AuthSessionService,
          useValue: {
            ready$: ready$.asObservable(),
            uid$: uid$.asObservable(),
            isTerminating$: terminating$.asObservable(),
          },
        },
        { provide: ApplicationErrorService, useValue: { report: vi.fn() } },
        { provide: ErrorNotificationService, useValue: { showError: vi.fn() } },
      ],
    });
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  function run(url = '/conta/seguranca'): Promise<GuardResult> {
    return firstValueFrom(
      TestBed.runInInjectionContext(
        () => authGuard({} as never, { url } as never)
      ) as Observable<GuardResult>
    );
  }

  function expectLogin(result: GuardResult, redirectTo: string): void {
    expect(result).toBeInstanceOf(UrlTree);
    const parsed = router.parseUrl(router.serializeUrl(result as UrlTree));
    expect(parsed.root.children['primary']?.segments.map((segment) => segment.path))
      .toEqual(['login']);
    expect(parsed.queryParams['redirectTo']).toBe(redirectTo);
  }

  it('preserva o nome authOnlyGuard como alias da mesma decisão canônica', () => {
    expect(authOnlyGuard).toBe(authGuard);
  });

  it('permite sessão operacional autenticada', async () => {
    expect(await run()).toBe(true);
  });

  it('não libera usuário Firebase técnico durante logout em andamento', async () => {
    terminating$.next(true);
    expectLogin(await run(), '/conta/seguranca');
  });

  it('preserva restauração tardia da sessão durante o refresh', async () => {
    uid$.next(null);
    const pending = run();
    uid$.next('user-a');
    expect(await pending).toBe(true);
  });

  it('cancela imediatamente a espera de restauração ao começar logout', async () => {
    uid$.next(null);
    const pending = run('/conta/assinatura');
    terminating$.next(true);
    expectLogin(await pending, '/conta/assinatura');
  });

  it('não libera UID após o logout ter iniciado', async () => {
    uid$.next(null);
    terminating$.next(true);
    uid$.next('stale-user');
    expectLogin(await run(), '/conta/seguranca');
  });

  it('mantém o fallback existente após esgotar a tolerância de refresh', async () => {
    vi.useFakeTimers();
    uid$.next(null);
    const pending = run('/conta');
    await vi.advanceTimersByTimeAsync(2000);
    expectLogin(await pending, '/conta');
  });

  it('aguarda ready$ para não redirecionar prematuramente o refresh', async () => {
    ready$.next(false);
    const pending = run('/conta');
    ready$.next(true);
    expect(await pending).toBe(true);
  });
});
