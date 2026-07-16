import { inject } from '@angular/core';
import { CanMatchFn, Route, Router, UrlSegment, UrlTree } from '@angular/router';
import { Observable, combineLatest, of } from 'rxjs';
import { catchError, filter, map, switchMap, take } from 'rxjs/operators';

import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import {
  IMediaPolicyResult,
  IMediaPolicyViewerSnapshot,
  MediaPolicyService,
} from 'src/app/core/services/media/media-policy.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

type MediaOwnerRedirectKind = 'fotos' | 'videos';

function buildRequestedUrl(segments: readonly UrlSegment[]): string {
  const suffix = segments.map((segment) => segment.path).filter(Boolean).join('/');
  return suffix ? `/media/${suffix}` : '/media';
}

function readOwnerUid(
  route: Route,
  segments: readonly UrlSegment[],
  authenticatedUid: string
): string {
  const rawIndex = route.data?.['mediaOwnerSegmentIndex'];
  const ownerSegmentIndex = Number(rawIndex);

  if (!Number.isInteger(ownerSegmentIndex) || ownerSegmentIndex < 0) {
    return authenticatedUid;
  }

  return String(segments[ownerSegmentIndex]?.path ?? '').trim();
}

function readOwnerRedirectKind(route: Route): MediaOwnerRedirectKind {
  return route.data?.['mediaOwnerRedirectKind'] === 'videos'
    ? 'videos'
    : 'fotos';
}

function buildLoginRedirect(
  router: Router,
  segments: readonly UrlSegment[]
): UrlTree {
  return router.createUrlTree(['/login'], {
    queryParams: {
      redirectTo: buildRequestedUrl(segments),
    },
  });
}

function buildOwnedLibraryRedirect(
  router: Router,
  authenticatedUid: string,
  route: Route
): UrlTree {
  return router.createUrlTree([
    '/media',
    'perfil',
    authenticatedUid,
    readOwnerRedirectKind(route),
  ]);
}

function reportGuardError(
  error: unknown,
  operation: string,
  globalErrorHandler: GlobalErrorHandlerService
): void {
  try {
    const normalized = error instanceof Error
      ? error
      : new Error('Falha ao validar acesso à mídia.');

    (normalized as any).original = error;
    (normalized as any).context = {
      scope: 'MediaRouteGuard',
      operation,
    };
    (normalized as any).skipUserNotification = true;

    globalErrorHandler.handleError(normalized);
  } catch {
    // A falha de telemetria não pode quebrar a navegação.
  }
}

function resolveUploadDeniedRoute(
  result: IMediaPolicyResult,
  router: Router,
  route: Route,
  segments: readonly UrlSegment[],
  authenticatedUid: string,
  notifier: ErrorNotificationService
): UrlTree {
  const redirectTo = buildRequestedUrl(segments);

  switch (result.reason) {
    case 'NOT_AUTHENTICATED':
      return buildLoginRedirect(router, segments);

    case 'NOT_OWNER':
      notifier.showWarning('Você só pode enviar mídia para o seu próprio perfil.');
      return buildOwnedLibraryRedirect(router, authenticatedUid, route);

    case 'EMAIL_UNVERIFIED':
      notifier.showWarning('Confirme seu e-mail antes de enviar fotos.');
      return router.createUrlTree(['/register/welcome'], {
        queryParams: {
          reason: 'email_unverified',
          redirectTo,
        },
      });

    case 'PROFILE_INCOMPLETE':
      notifier.showWarning('Conclua seu perfil antes de enviar fotos.');
      return router.createUrlTree(['/register/finalizar-cadastro'], {
        queryParams: {
          reason: 'profile_incomplete',
          redirectTo,
        },
      });

    case 'INTERACTION_BLOCKED':
    case 'BLOCKED':
      notifier.showError('O envio de mídia está indisponível para esta conta.');
      return router.parseUrl('/dashboard/principal');

    default:
      notifier.showError('Não foi possível liberar o envio de mídia.');
      return router.parseUrl('/dashboard/principal');
  }
}

/**
 * Impede que bibliotecas privadas sejam carregadas para um UID diferente do
 * usuário autenticado. Rules e Functions continuam sendo a barreira definitiva.
 */
export const mediaOwnerCanMatch: CanMatchFn = (
  route,
  segments
): Observable<boolean | UrlTree> => {
  const router = inject(Router);
  const access = inject(AccessControlService);
  const notifier = inject(ErrorNotificationService);
  const globalErrorHandler = inject(GlobalErrorHandlerService);

  return combineLatest([access.ready$, access.authUid$]).pipe(
    filter(([ready]) => ready === true),
    take(1),
    map(([, authenticatedUid]) => {
      if (!authenticatedUid) {
        return buildLoginRedirect(router, segments);
      }

      const ownerUid = readOwnerUid(route, segments, authenticatedUid);

      if (!ownerUid || ownerUid !== authenticatedUid) {
        notifier.showWarning('Você só pode acessar sua própria biblioteca de mídia.');
        return buildOwnedLibraryRedirect(router, authenticatedUid, route);
      }

      return true;
    }),
    catchError((error: unknown) => {
      reportGuardError(error, 'mediaOwnerCanMatch', globalErrorHandler);
      notifier.showError('Falha ao validar acesso à biblioteca de mídia.');
      return of(router.parseUrl('/dashboard/principal'));
    })
  );
};

/**
 * Valida as condições de upload antes de baixar o componente de envio.
 */
export const mediaUploadEligibilityCanMatch: CanMatchFn = (
  route,
  segments
): Observable<boolean | UrlTree> => {
  const router = inject(Router);
  const access = inject(AccessControlService);
  const policy = inject(MediaPolicyService);
  const notifier = inject(ErrorNotificationService);
  const globalErrorHandler = inject(GlobalErrorHandlerService);

  return combineLatest([
    access.ready$,
    access.authUid$,
    access.appUser$,
    access.emailVerified$,
    access.profileCompleted$,
    access.isBlocked$,
  ]).pipe(
    filter(([ready, , appUser]) => ready === true && appUser !== undefined),
    take(1),
    switchMap(([
      ,
      authenticatedUid,
      appUser,
      emailVerified,
      profileCompleted,
      accountBlocked,
    ]) => {
      if (!authenticatedUid) {
        return of(buildLoginRedirect(router, segments));
      }

      const ownerUid = readOwnerUid(route, segments, authenticatedUid);
      const viewer: IMediaPolicyViewerSnapshot = {
        uid: authenticatedUid,
        emailVerified,
        profileCompleted,
        interactionBlocked:
          accountBlocked || appUser?.interactionBlocked === true,
      };

      return policy.canUploadProfilePhotosForViewer$(viewer, ownerUid).pipe(
        map((result) => {
          if (result.decision === 'ALLOW') {
            return true;
          }

          return resolveUploadDeniedRoute(
            result,
            router,
            route,
            segments,
            authenticatedUid,
            notifier
          );
        })
      );
    }),
    catchError((error: unknown) => {
      reportGuardError(
        error,
        'mediaUploadEligibilityCanMatch',
        globalErrorHandler
      );
      notifier.showError('Falha ao validar permissão para enviar mídia.');
      return of(router.parseUrl('/dashboard/principal'));
    })
  );
};
