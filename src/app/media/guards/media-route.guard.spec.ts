import { TestBed } from '@angular/core/testing';
import { CanMatchFn, Route, Router, UrlSegment, UrlTree } from '@angular/router';
import { BehaviorSubject, firstValueFrom, isObservable, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { MediaPolicyService } from 'src/app/core/services/media/media-policy.service';
import {
  mediaOwnerCanMatch,
  mediaUploadEligibilityCanMatch,
} from './media-route.guard';

type FakeUrlTree = UrlTree & {
  kind: 'create' | 'parse';
  commands?: unknown[];
  extras?: unknown;
  url?: string;
};

describe('media route guards', () => {
  const readySubject = new BehaviorSubject(true);
  const authUidSubject = new BehaviorSubject<string | null>('owner-1');
  const appUserSubject = new BehaviorSubject<any>({
    uid: 'owner-1',
    emailVerified: true,
    profileCompleted: true,
    interactionBlocked: false,
  });
  const emailVerifiedSubject = new BehaviorSubject(true);
  const profileCompletedSubject = new BehaviorSubject(true);
  const blockedSubject = new BehaviorSubject(false);

  const createUrlTree = vi.fn(
    (commands: unknown[], extras?: unknown) =>
      ({ kind: 'create', commands, extras } as FakeUrlTree)
  );
  const parseUrl = vi.fn(
    (url: string) => ({ kind: 'parse', url } as FakeUrlTree)
  );
  const showWarning = vi.fn();
  const showError = vi.fn();
  const handleError = vi.fn();
  const canUploadProfilePhotosForViewer$ = vi.fn(() =>
    of({ decision: 'ALLOW' as const })
  );

  beforeEach(() => {
    readySubject.next(true);
    authUidSubject.next('owner-1');
    appUserSubject.next({
      uid: 'owner-1',
      emailVerified: true,
      profileCompleted: true,
      interactionBlocked: false,
    });
    emailVerifiedSubject.next(true);
    profileCompletedSubject.next(true);
    blockedSubject.next(false);

    createUrlTree.mockClear();
    parseUrl.mockClear();
    showWarning.mockClear();
    showError.mockClear();
    handleError.mockClear();
    canUploadProfilePhotosForViewer$.mockReset();
    canUploadProfilePhotosForViewer$.mockReturnValue(
      of({ decision: 'ALLOW' as const })
    );

    TestBed.configureTestingModule({
      providers: [
        {
          provide: Router,
          useValue: {
            createUrlTree,
            parseUrl,
          },
        },
        {
          provide: AccessControlService,
          useValue: {
            ready$: readySubject.asObservable(),
            authUid$: authUidSubject.asObservable(),
            appUser$: appUserSubject.asObservable(),
            emailVerified$: emailVerifiedSubject.asObservable(),
            profileCompleted$: profileCompletedSubject.asObservable(),
            isBlocked$: blockedSubject.asObservable(),
          },
        },
        {
          provide: MediaPolicyService,
          useValue: {
            canUploadProfilePhotosForViewer$,
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showWarning,
            showError,
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError,
          },
        },
      ],
    });
  });

  it('permite carregar a biblioteca privada do próprio usuário', async () => {
    const result = await runGuard(
      mediaOwnerCanMatch,
      privatePhotosRoute(),
      segments('perfil', 'owner-1', 'fotos')
    );

    expect(result).toBe(true);
    expect(showWarning).not.toHaveBeenCalled();
  });

  it('bloqueia biblioteca privada de outro usuário antes do lazy loading', async () => {
    const result = await runGuard(
      mediaOwnerCanMatch,
      privatePhotosRoute(),
      segments('perfil', 'other-user', 'fotos')
    ) as FakeUrlTree;

    expect(result.kind).toBe('create');
    expect(result.commands).toEqual([
      '/media',
      'perfil',
      'owner-1',
      'fotos',
    ]);
    expect(showWarning).toHaveBeenCalledOnce();
  });

  it('redireciona upload quando o e-mail ainda não foi verificado', async () => {
    emailVerifiedSubject.next(false);
    canUploadProfilePhotosForViewer$.mockReturnValue(
      of({ decision: 'DENY' as const, reason: 'EMAIL_UNVERIFIED' as const })
    );

    const result = await runGuard(
      mediaUploadEligibilityCanMatch,
      uploadRoute(),
      segments('perfil', 'owner-1', 'fotos', 'upload')
    ) as FakeUrlTree;

    expect(result.kind).toBe('create');
    expect(result.commands).toEqual(['/register/welcome']);
    expect(result.extras).toEqual({
      queryParams: {
        reason: 'email_unverified',
        redirectTo: '/media/perfil/owner-1/fotos/upload',
      },
    });
  });

  it('permite upload quando a política autoriza o usuário', async () => {
    const result = await runGuard(
      mediaUploadEligibilityCanMatch,
      uploadRoute(),
      segments('perfil', 'owner-1', 'fotos', 'upload')
    );

    expect(result).toBe(true);
    expect(canUploadProfilePhotosForViewer$).toHaveBeenCalledWith(
      {
        uid: 'owner-1',
        emailVerified: true,
        profileCompleted: true,
        interactionBlocked: false,
      },
      'owner-1'
    );
  });
});

function privatePhotosRoute(): Route {
  return {
    path: 'perfil/:id/fotos',
    data: {
      mediaOwnerSegmentIndex: 1,
      mediaOwnerRedirectKind: 'fotos',
    },
  };
}

function uploadRoute(): Route {
  return {
    path: 'perfil/:id/fotos/upload',
    data: {
      mediaOwnerSegmentIndex: 1,
      mediaOwnerRedirectKind: 'fotos',
    },
  };
}

function segments(...paths: string[]): UrlSegment[] {
  return paths.map((path) => new UrlSegment(path, {}));
}

async function runGuard(
  guard: CanMatchFn,
  route: Route,
  urlSegments: UrlSegment[]
): Promise<boolean | UrlTree> {
  const result = TestBed.runInInjectionContext(() => guard(route, urlSegments));

  if (isObservable(result)) {
    return firstValueFrom(result);
  }

  return Promise.resolve(result);
}
