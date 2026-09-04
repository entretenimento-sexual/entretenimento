import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { BehaviorSubject, Observable, firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import type { IUserDados } from '@core/interfaces/iuser-dados';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
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

  async function runLifecycleGuard(url = '/dashboard') {
    return firstValueFrom(
      TestBed.runInInjectionContext(() =>
        accountLifecycleGuard({} as never, { url } as never)
      ) as Observable<boolean | UrlTree>
    );
  }

  async function runStatusGuard() {
    return firstValueFrom(
      TestBed.runInInjectionContext(() =>
        accountStatusPageGuard({} as never, {} as never)
      ) as Observable<boolean | UrlTree>
    );
  }

  it('libera conta ativa quando perfil e Auth possuem o mesmo UID', async () => {
    expect(await runLifecycleGuard()).toBe(true);
  });

  it('bloqueia perfil resolvido como null sem assumir active', async () => {
    currentUser$.next(null);

    const result = await runLifecycleGuard('/dashboard/principal');

    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toContain('/conta/status');
  });

  it('bloqueia UID divergente da sessão canônica', async () => {
    currentUser$.next(user({ uid: 'stale-user' }));

    const result = await runLifecycleGuard();

    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toContain('/conta/status');
  });

  it('bloqueia accountLocked mesmo com accountStatus active', async () => {
    currentUser$.next(user({ accountLocked: true }));

    const result = await runLifecycleGuard();

    expect(result).toBeInstanceOf(UrlTree);
  });

  it('mantém a página de status acessível para estado unknown', async () => {
    currentUser$.next(null);

    expect(await runStatusGuard()).toBe(true);
  });

  it('retira conta ativa da página de status', async () => {
    const result = await runStatusGuard();

    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toBe('/conta');
  });
});
