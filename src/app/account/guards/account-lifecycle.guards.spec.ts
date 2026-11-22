import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { BehaviorSubject, Observable, firstValueFrom, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IUserDados } from '@core/interfaces/iuser-dados';
import { AUTH_GUARD_WAIT_MS } from '@core/guards/_shared-guard/guard-utils';
import { AuthAppBlockService } from '@core/services/autentication/auth/auth-app-block.service';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { PostAuthNavigationService } from 'src/app/register-module/data-access/post-auth-navigation.service';
import { accountLifecycleGuard } from './account-lifecycle.guard';
import { accountStatusPageGuard } from './account-status-page.guard';

function user(overrides: Partial<IUserDados> = {}): IUserDados {
  return {
    uid: 'user-1',
    email: null,
    photoURL: null,
    role: 'free',
    lastLogin: 1,
    descricao: '',
    isSubscriber: false,
    accountStatus: 'active',
    profileCompleted: true,
    ...overrides,
  } as IUserDados;
}

describe('account lifecycle guards', () => {
  let ready$: BehaviorSubject<boolean>;
  let authUser$: BehaviorSubject<{ uid: string } | null>;
  let currentUser$: BehaviorSubject<IUserDados | null | undefined>;
  let router: Router;

  beforeEach(() => {
    ready$ = new BehaviorSubject(true);
    authUser$ = new BehaviorSubject<{ uid: string } | null>({ uid: 'user-1' });
    currentUser$ = new BehaviorSubject<IUserDados | null | undefined>(user());

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PostAuthNavigationService, useValue: {
          resolveForCurrentSession$: (_uid: string, target: string | null) => of(currentUser$.value
            ? '/register/finalizar-cadastro?reason=profile_incomplete&redirectTo=' + encodeURIComponent(target ?? '/preferencias/editar')
            : '/register/recuperar-conta?redirectTo=' + encodeURIComponent(target ?? '/preferencias/editar')),
        } },
        {
          provide: AuthSessionService,
          useValue: {
            ready$: ready$.asObservable(),
            authUser$: authUser$.asObservable(),
          },
        },
        {
          provide: CurrentUserStoreService,
          useValue: { user$: currentUser$.asObservable() },
        },
      ],
    });

    router = TestBed.inject(Router);
  });

  afterEach(() => vi.useRealTimers());

  async function runLifecycleGuard(url = '/dashboard', allowPendingAgeRegistration = false) {
    return firstValueFrom(
      TestBed.runInInjectionContext(() =>
        accountLifecycleGuard({ data: { allowPendingAgeRegistration } } as never, { url } as never)
      ) as Observable<boolean | UrlTree>
    );
  }

  async function runStatusGuard() {
    return firstValueFrom(
      TestBed.runInInjectionContext(() =>
        accountStatusPageGuard({} as never, { url: '/conta/status' } as never)
      ) as Observable<boolean | UrlTree>
    );
  }

  it('reage ao bloqueio da sessão enquanto a consulta do perfil está pendente', async () => {
    vi.useFakeTimers();
    currentUser$.next(undefined);
    const lifecycle = runLifecycleGuard('/dashboard/principal');
    const status = runStatusGuard();

    const block = TestBed.inject(AuthAppBlockService);
    block.set('doc-missing-confirmed', 'user-1');
    await vi.advanceTimersByTimeAsync(AUTH_GUARD_WAIT_MS);

    expect(router.serializeUrl(await lifecycle as UrlTree)).toContain('/conta/status');
    expect(await status).toBe(true);
    expect(block.domainBlockFor('user-2')).toBeNull();
  });

  it('libera conta ativa quando perfil e Auth possuem o mesmo UID', async () => {
    expect(await runLifecycleGuard()).toBe(true);
  });

  it('oferece nova tentativa sem liberar a rota quando o perfil segue pendente', async () => {
    vi.useFakeTimers();
    currentUser$.next(undefined);
    const pending = runLifecycleGuard('/adulto/verificar-idade?redirectTo=%2Fconta', true);
    await vi.advanceTimersByTimeAsync(AUTH_GUARD_WAIT_MS);
    const result = await pending;
    expect(result).toBeInstanceOf(UrlTree);
    expect((result as UrlTree).queryParams).toEqual({
      reason: 'auth_unavailable',
      redirectTo: '/adulto/verificar-idade?redirectTo=%2Fconta',
    });
  });

  it('bloqueia perfil resolvido como null sem assumir active', async () => {
    currentUser$.next(null);

    const result = await runLifecycleGuard('/dashboard/principal');

    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toContain('/register/recuperar-conta');
  });

  it('aguarda o perfil da sessão atual e ignora a projeção de outro UID', async () => {
    currentUser$.next(user({ uid: 'stale-user' }));
    const pending = runLifecycleGuard();
    currentUser$.next(user());
    expect(await pending).toBe(true);
  });

  it('bloqueia accountLocked mesmo com accountStatus active', async () => {
    currentUser$.next(user({ accountLocked: true }));

    const result = await runLifecycleGuard();

    expect(result).toBeInstanceOf(UrlTree);
  });

  it('libera a etapa etária de um cadastro pendente com interações bloqueadas', async () => {
    const pending = user({
      profileCompleted: false,
      registrationFlowVersion: 'v3-private-by-default',
      publicVisibility: 'hidden',
      interactionBlocked: true,
      loginAllowed: true,
    });
    currentUser$.next(pending);

    expect(await runLifecycleGuard('/adulto/verificar-idade', true)).toBe(true);
    const result = await runLifecycleGuard('/dashboard/principal');
    expect(router.serializeUrl(result as UrlTree)).toContain('/register/finalizar-cadastro');
    expect((result as UrlTree).queryParams).toMatchObject({
      reason: 'profile_incomplete', redirectTo: '/dashboard/principal',
    });
    expect(router.serializeUrl(await runStatusGuard() as UrlTree)).toContain('/register/finalizar-cadastro');

    currentUser$.next({ ...pending, ageReverificationRestrictedAt: 1 });
    const restricted = await runLifecycleGuard('/adulto/verificar-idade', true);
    expect(router.serializeUrl(restricted as UrlTree)).toContain('/conta/status');
    expect(await runStatusGuard()).toBe(true);
  });

  it('mantém a página de status acessível para estado unknown', async () => {
    currentUser$.next(null);

    expect(await runStatusGuard()).toBe(true);
  });

  it.each(['/dashboard/principal', '/chat', '/preferencias/editar'])(
    'veda %s após o aceite dos Termos até a conclusão do perfil', async (url) => {
      const pending = user({
        emailVerified: true,
        acceptedTerms: { accepted: true, date: 1, version: 'v3', termsDocumentVersion: '2026-09-29.1', privacyNoticeVersion: '2026-09-29.1', acknowledgedPrivacyNotice: true },
        profileCompleted: false,
        registrationFlowVersion: 'v3-private-by-default',
        publicVisibility: 'hidden',
        interactionBlocked: true,
        loginAllowed: true,
      });
      currentUser$.next(pending);

      const result = await runLifecycleGuard(url) as UrlTree;
      expect(router.serializeUrl(result)).toContain('/register/finalizar-cadastro');
      expect(result.queryParams['redirectTo']).toBe(url);

      currentUser$.next({ ...pending, profileCompleted: true, publicVisibility: 'visible', interactionBlocked: false });
      expect(await runLifecycleGuard(url)).toBe(true);
    }
  );

  it('oferece nova tentativa quando até a página de status espera pelo perfil', async () => {
    vi.useFakeTimers();
    currentUser$.next(undefined);
    const pending = runStatusGuard();
    await vi.advanceTimersByTimeAsync(AUTH_GUARD_WAIT_MS);
    const result = await pending;
    expect((result as UrlTree).queryParams).toEqual({
      reason: 'auth_unavailable',
      redirectTo: '/conta/status',
    });
  });

  it('retira conta ativa da página de status', async () => {
    const result = await runStatusGuard();

    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toBe('/conta');
  });
});
