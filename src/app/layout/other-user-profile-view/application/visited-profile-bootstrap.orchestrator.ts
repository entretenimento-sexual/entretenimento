import { Injectable } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { catchError, distinctUntilChanged, map, switchMap, take } from 'rxjs/operators';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';

export type VisitedProfileBootstrapResult =
  | {
      kind: 'loaded';
      targetUid: string;
      profile: IUserDados;
    }
  | {
      kind: 'missing';
      targetUid: string | null;
    }
  | {
      kind: 'load-error';
      targetUid: string;
    }
  | {
      kind: 'redirect-own-profile';
      targetUid: string;
    };

@Injectable()
export class VisitedProfileBootstrapOrchestrator {
  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly authSession: AuthSessionService,
    private readonly firestoreUserQuery: FirestoreUserQueryService,
    private readonly applicationError: ApplicationErrorService
  ) {}

  /**
   * A fonte de UID pertence à camada de aplicação, não ao componente visual.
   * Em navegação reutilizada, a emissão vigente substitui o snapshot anterior.
   */
  observeTargetUid$(): Observable<string> {
    return this.route.paramMap.pipe(
      map((params) =>
        String(params.get('uid') ?? params.get('id') ?? '').trim()
      ),
      distinctUntilChanged()
    );
  }

  load$(
    targetUidFromNavigation?: string | null
  ): Observable<VisitedProfileBootstrapResult> {
    // The explicit router emission is authoritative on reused components:
    // snapshot-only reads can race with a subsequent profile navigation.
    const targetUid = targetUidFromNavigation === undefined
      ? this.getTargetUidFromRoute()
      : String(targetUidFromNavigation ?? '').trim() || null;

    if (!targetUid) {
      this.report(
        new Error('UID não encontrado na rota.'),
        'VisitedProfileBootstrapOrchestrator.route',
        'UID não encontrado na rota.',
        false
      );
      return of({
        kind: 'missing',
        targetUid: null,
      });
    }

    return this.authSession.uid$.pipe(
      take(1),
      switchMap((authUid) => {
        const safeAuthUid = String(authUid ?? '').trim();

        if (safeAuthUid && safeAuthUid === targetUid) {
          return this.redirectOwnProfile$(targetUid);
        }

        return this.firestoreUserQuery.getPublicUserById$(targetUid, {
          propagateErrors: true,
        }).pipe(
          map((profile) => {
            if (profile) {
              return {
                kind: 'loaded',
                targetUid,
                profile,
              } as VisitedProfileBootstrapResult;
            }

            this.report(
              new Error('Usuário não encontrado ou indisponível.'),
              'VisitedProfileBootstrapOrchestrator.missingPublicProfile',
              'Usuário não encontrado ou indisponível.'
            );

            return {
              kind: 'missing',
              targetUid,
            } as VisitedProfileBootstrapResult;
          }),
          catchError((error) => {
            this.report(
              error,
              'VisitedProfileBootstrapOrchestrator.loadPublicProfile',
              'Falha ao carregar perfil do usuário.'
            );

            return of({
              kind: 'load-error',
              targetUid,
            } as VisitedProfileBootstrapResult);
          })
        );
      })
    );
  }

  private redirectOwnProfile$(
    targetUid: string
  ): Observable<VisitedProfileBootstrapResult> {
    return new Observable<VisitedProfileBootstrapResult>((subscriber) => {
      this.router
        .navigate(['/perfil'], { replaceUrl: true })
        .then(() => {
          subscriber.next({
            kind: 'redirect-own-profile',
            targetUid,
          });
          subscriber.complete();
        })
        .catch((error) => {
          this.report(
            error,
            'VisitedProfileBootstrapOrchestrator.redirectOwnProfile',
            'Não foi possível redirecionar para seu perfil.'
          );

          subscriber.next({
            kind: 'missing',
            targetUid,
          });
          subscriber.complete();
        });
    });
  }

  private getTargetUidFromRoute(): string | null {
    const uid =
      this.route.snapshot.paramMap.get('uid') ??
      this.route.snapshot.paramMap.get('id');

    return String(uid ?? '').trim() || null;
  }

  private report(
    error: unknown,
    operation: string,
    fallbackMessage: string,
    notify = true
  ): void {
    this.applicationError.report(error, {
      feature: 'profile-view',
      operation,
      fallbackMessage,
      presentation: notify
        ? undefined
        : { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'VisitedProfileBootstrapOrchestrator',
      },
    });
  }
}
