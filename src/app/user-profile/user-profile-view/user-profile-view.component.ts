// src/app/user-profile/user-profile-view/user-profile-view.component.ts
// -----------------------------------------------------------------------------
// PERFIL PRÓPRIO
// -----------------------------------------------------------------------------
//
// Este componente deve exibir SOMENTE o perfil do usuário autenticado.
//
// Regra definitiva:
// - /perfil               -> meu perfil
// - /perfil/:meuUid       -> meu perfil
// - /perfil/:uidDeOutro   -> redireciona para /outro-perfil/:uidDeOutro
//
// Motivo:
// - Perfil próprio pode usar selectCurrentUser, pois vem do estado autenticado.
// - Perfil alheio deve usar projeção pública.
// - Isso evita tela travada em "Carregando..." quando o outro usuário não está
//   previamente hidratado no usersMap do NgRx.
//
// Supressão explícita:
// - Este componente NÃO usa selectUserByIdOrNull.
// - Este componente NÃO busca public_profiles.
// - Este componente NÃO renderiza edição/social/fotos se detectar perfil alheio.
// - Perfil alheio pertence ao OtherUserProfileViewComponent.

import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Observable, combineLatest, of } from 'rxjs';
import {
  auditTime,
  catchError,
  distinctUntilChanged,
  filter,
  map,
  scan,
  shareReplay,
  switchMap,
  tap,
} from 'rxjs/operators';
import { Store } from '@ngrx/store';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AppState } from 'src/app/store/states/app.state';
import {
  selectCurrentUser,
  selectCurrentUserStatus,
  selectCurrentUserUid,
  type CurrentUserStatus,
} from 'src/app/store/selectors/selectors.user/user.selectors';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';

import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';

import { SocialLinksAccordionComponent } from './user-social-links-accordion/user-social-links-accordion.component';
import { UserPhotoManagerComponent } from '../user-photo-manager/user-photo-manager.component';
import { DateFormatPipe } from 'src/app/shared/pipes/date-format.pipe';
import { CapitalizePipe } from 'src/app/shared/pipes/capitalize.pipe';

@Component({
  selector: 'app-user-profile-view',
  templateUrl: './user-profile-view.component.html',
  styleUrls: ['./user-profile-view.component.css'],
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    SocialLinksAccordionComponent,
    UserPhotoManagerComponent,
    DateFormatPipe,
    CapitalizePipe,
  ],
})
export class UserProfileViewComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly store = inject<Store<AppState>>(Store as any);
  private readonly destroyRef = inject(DestroyRef);

  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly errorNotification = inject(ErrorNotificationService);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);

  public uid: string | null = null;
  private authUid: string | null = null;

  public readonly status$: Observable<CurrentUserStatus> =
    this.store.select(selectCurrentUserStatus);

  public usuario$: Observable<IUserDados | null> = of(null);
  public redirectingToOtherProfile = false;

  ngOnInit(): void {
    const authUid$ = this.store.select(selectCurrentUserUid).pipe(
      map((uid) => (uid ?? '').trim() || null),
      tap((uid) => {
        this.authUid = uid;
      }),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    const routeUid$ = this.route.paramMap.pipe(
      map((params) => {
        const uid = params.get('uid') ?? params.get('id');
        return uid?.trim() || null;
      }),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    const context$ = combineLatest([routeUid$, authUid$]).pipe(
      tap(([routeUid, authUid]) => {
        const isExternal =
          !!routeUid &&
          !!authUid &&
          routeUid !== authUid;

        this.redirectingToOtherProfile = isExternal;
        this.uid = isExternal ? authUid : routeUid ?? authUid ?? null;
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    context$
      .pipe(
        filter(([routeUid, authUid]) => !!routeUid && !!authUid && routeUid !== authUid),
        tap(([routeUid]) => {
          const targetUid = routeUid ?? '';

          this.dbg('external profile detected; redirecting to OtherUserProfileView', {
            hasTargetUid: !!targetUid,
          });

          this.router.navigate(['/outro-perfil', targetUid], { replaceUrl: true })
            .catch((error) => {
              this.reportError(
                'Não foi possível redirecionar para o perfil público.',
                error,
                {
                  op: 'redirectExternalProfile',
                  hasTargetUid: !!targetUid,
                }
              );
            });
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.usuario$ = context$.pipe(
      switchMap(([routeUid, authUid]) => {
        if (!authUid) {
          return of(null);
        }

        if (routeUid && routeUid !== authUid) {
          return of(null);
        }

        return this.store.select(selectCurrentUser);
      }),
      catchError((error) => {
        this.reportError(
          'Não foi possível carregar seu perfil no momento.',
          error,
          { op: 'usuario$' }
        );

        return of(null);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    context$
      .pipe(
        auditTime(500),
        tap(([routeUid, authUid]) => {
          this.dbg('context$', {
            hasRouteUid: !!routeUid,
            hasAuthUid: !!authUid,
            isOwnProfile: !!authUid && (!routeUid || routeUid === authUid),
            redirectingToOtherProfile: !!routeUid && !!authUid && routeUid !== authUid,
          });
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.status$
      .pipe(
        auditTime(500),
        tap((status) => this.dbg('currentUserStatus$', status)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.usuario$
      .pipe(
        filter(Boolean),
        scan((count) => count + 1, 0),
        auditTime(1000),
        tap((count) => this.dbg('usuario$ emits/sec', count)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  onAvatarImageError(event: Event): void {
    const image = event.target as HTMLImageElement | null;
    if (!image) return;

    const fallback = 'assets/imagem-padrao.webp';

    if (!image.src.endsWith(fallback)) {
      image.src = fallback;
    }
  }

  isCouple(gender: string | undefined): boolean {
    return !!gender && ['casal-ele-ele', 'casal-ele-ela', 'casal-ela-ela'].includes(gender);
  }

  getCoupleDescription(
    gender: string | undefined,
    partner1Orientation: string | undefined,
    partner2Orientation: string | undefined
  ): string {
    const o1 = this.getOrientationDescription(partner1Orientation);
    const o2 = this.getOrientationDescription(partner2Orientation);

    if (gender === 'casal-ele-ele') return `Ele ${o1} / Ele ${o2}`;
    if (gender === 'casal-ele-ela') return `Ele ${o1} / Ela ${o2}`;
    if (gender === 'casal-ela-ela') return `Ela ${o1} / Ela ${o2}`;

    return '';
  }

  getOrientationDescription(orientation: string | undefined): string {
    switch (orientation) {
      case 'bissexual':
        return 'bissexual';
      case 'homossexual':
        return 'homossexual';
      case 'heterossexual':
        return 'heterossexual';
      case 'pansexual':
        return 'pansexual';
      default:
        return '';
    }
  }

  isOnOwnProfile(): boolean {
    return !!this.authUid && !!this.uid && this.authUid === this.uid && !this.redirectingToOtherProfile;
  }

  private dbg(message: string, extra?: unknown): void {
    this.privacyDebug.log('profile', `UserProfileView: ${message}`, extra);
  }

  private reportError(
    userMessage: string,
    error: unknown,
    context?: Record<string, unknown>
  ): void {
    try {
      this.errorNotification.showError(userMessage);
    } catch {
      // noop
    }

    try {
      const err = error instanceof Error ? error : new Error(userMessage);

      (err as any).original = error;
      (err as any).context = {
        scope: 'UserProfileViewComponent',
        ...(context ?? {}),
      };
      (err as any).skipUserNotification = true;

      this.globalError.handleError(err);
    } catch {
      // noop
    }
  }
}