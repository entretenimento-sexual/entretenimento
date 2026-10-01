import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { Observable, combineLatest, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  map,
  shareReplay,
  switchMap,
  tap,
} from 'rxjs/operators';

import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { NetworkStatusService } from '@core/services/network/network-status.service';
import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import type { ContentStateKind } from 'src/app/shared/content-state/content-state.component';
import * as UserActions from 'src/app/store/actions/actions.user/user.actions';
import {
  selectCurrentUser,
  selectCurrentUserStatus,
  selectCurrentUserUid,
  type CurrentUserStatus,
} from 'src/app/store/selectors/selectors.user/user.selectors';
import { AppState } from 'src/app/store/states/app.state';

export interface OwnProfileContextVm {
  readonly uid: string | null;
  readonly authUid: string | null;
  readonly routeUid: string | null;
  readonly redirectingToOtherProfile: boolean;
}

export interface OwnProfileContentStateVm {
  readonly state: ContentStateKind;
  readonly title: string;
  readonly message: string;
  readonly actionLabel: string;
  readonly compact: boolean;
}

@Injectable()
export class OwnProfileContextFacade {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly store = inject<Store<AppState>>(Store as any);
  private readonly network = inject(NetworkStatusService);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly errorNotification = inject(ErrorNotificationService);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);
  private readonly destroyRef = inject(DestroyRef);

  readonly status$: Observable<CurrentUserStatus> =
    this.store.select(selectCurrentUserStatus);

  readonly authUid$ = this.store.select(selectCurrentUserUid).pipe(
    map((uid) => String(uid ?? '').trim() || null),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly routeUid$ = this.route.paramMap.pipe(
    map((params) => {
      const uid = params.get('uid') ?? params.get('id');
      return String(uid ?? '').trim() || null;
    }),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly context$: Observable<OwnProfileContextVm> = combineLatest([
    this.routeUid$,
    this.authUid$,
  ]).pipe(
    map(([routeUid, authUid]) => {
      const redirectingToOtherProfile =
        !!routeUid && !!authUid && routeUid !== authUid;

      return {
        uid: redirectingToOtherProfile
          ? authUid
          : routeUid ?? authUid ?? null,
        authUid,
        routeUid,
        redirectingToOtherProfile,
      };
    }),
    distinctUntilChanged(
      (previous, current) =>
        previous.uid === current.uid &&
        previous.authUid === current.authUid &&
        previous.routeUid === current.routeUid &&
        previous.redirectingToOtherProfile ===
          current.redirectingToOtherProfile
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly user$: Observable<IUserDados | null> = this.context$.pipe(
    switchMap((context) => {
      if (!context.authUid || context.redirectingToOtherProfile) {
        return of(null);
      }

      return this.store.select(selectCurrentUser);
    }),
    catchError((error) => {
      this.report(
        error,
        'OwnProfileContextFacade.user$',
        'Não foi possível carregar seu perfil no momento.'
      );
      return of(null);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly contentState$: Observable<OwnProfileContentStateVm | null> =
    combineLatest([
      this.status$,
      this.user$,
      this.network.isOffline$,
    ]).pipe(
      map(([status, user, offline]) =>
        this.resolveContentState(status, user, offline)
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  init(): void {
    this.context$
      .pipe(
        filter((context) => context.redirectingToOtherProfile),
        tap((context) => {
          const targetUid = context.routeUid ?? '';

          this.debug(
            'external profile detected; redirecting to OtherUserProfileView',
            { hasTargetUid: !!targetUid }
          );

          this.router
            .navigate(['/outro-perfil', targetUid], { replaceUrl: true })
            .catch((error) => {
              this.report(
                error,
                'OwnProfileContextFacade.redirectExternalProfile',
                'Não foi possível redirecionar para o perfil público.',
                { hasTargetUid: !!targetUid }
              );
            });
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  retryProfile(authUid: string | null): void {
    const safeAuthUid = String(authUid ?? '').trim();

    if (!safeAuthUid) {
      this.router.navigate(['/login']).catch(() => {});
      return;
    }

    if (!this.network.isOnlineSnapshot()) {
      this.errorNotification.showWarning(
        'Aguarde a conexão voltar para atualizar seu perfil.'
      );
      return;
    }

    this.store.dispatch(
      UserActions.observeUserChanges({ uid: safeAuthUid })
    );
  }

  private resolveContentState(
    status: CurrentUserStatus,
    user: IUserDados | null,
    offline: boolean
  ): OwnProfileContentStateVm | null {
    if (user && (offline || status === 'loading_profile')) {
      return {
        state: 'stale',
        title: 'Exibindo seu perfil salvo',
        message: offline
          ? 'A conexão está indisponível. Alterações recentes podem aparecer quando você voltar a ficar online.'
          : 'Seu perfil está sendo atualizado em segundo plano.',
        actionLabel: offline ? '' : 'Atualizar',
        compact: true,
      };
    }

    if (user) return null;

    if (status === 'boot' || status === 'loading_profile') {
      return {
        state: 'loading',
        title: '',
        message: 'Carregando seu perfil.',
        actionLabel: '',
        compact: false,
      };
    }

    if (offline) {
      return {
        state: 'offline',
        title: 'Perfil indisponível sem conexão',
        message:
          'Este perfil ainda não está no cache deste dispositivo. Conecte-se para carregá-lo.',
        actionLabel: 'Tentar novamente',
        compact: false,
      };
    }

    if (status === 'signed_out') {
      return {
        state: 'error',
        title: 'Sessão não encontrada',
        message: 'Entre novamente para acessar seu perfil.',
        actionLabel: 'Entrar',
        compact: false,
      };
    }

    return {
      state: 'error',
      title: 'Seu perfil não está disponível',
      message:
        'A sessão continua ativa, mas o perfil não pôde ser hidratado. Tente novamente.',
      actionLabel: 'Tentar novamente',
      compact: false,
    };
  }

  private debug(message: string, extra?: unknown): void {
    this.privacyDebug.log(
      'profile',
      `OwnProfileContextFacade: ${message}`,
      extra
    );
  }

  private report(
    error: unknown,
    operation: string,
    fallbackMessage: string,
    metadata?: Readonly<Record<string, unknown>>
  ): void {
    this.applicationError.report(error, {
      feature: 'profile-view',
      operation,
      fallbackMessage,
      metadata: {
        scope: 'OwnProfileContextFacade',
        ...(metadata ?? {}),
      },
    });
  }
}
