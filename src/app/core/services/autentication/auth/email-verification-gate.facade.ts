// src/app/core/services/autentication/auth/email-verification-gate.facade.ts
// -----------------------------------------------------------------------------
// EmailVerificationGateFacade
// -----------------------------------------------------------------------------
//
// Responsabilidade:
// - exibir banner de verificação de e-mail em áreas que exigem ou recomendam
//   e-mail verificado.
//
// Regra importante:
// - este banner NÃO deve aparecer enquanto profileCompleted=false.
// - enquanto o perfil estiver incompleto, a prioridade visual e de navegação é
//   "complete seu perfil", não "verifique seu e-mail".
//
// Separação:
// - profileCompleted controla onboarding/navegação básica.
// - emailVerified controla confiança e recursos sensíveis.

import { Injectable, inject } from '@angular/core';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';

import { Observable, Subject, combineLatest, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  exhaustMap,
  filter,
  map,
  shareReplay,
  startWith,
  tap,
} from 'rxjs/operators';

import { AccessControlService } from './access-control.service';
import { AuthSessionService } from './auth-session.service';
import { CurrentUserStoreService } from './current-user-store.service';
import { ErrorNotificationService } from '../../error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { EmailVerificationService } from '../register/email-verification.service';

type BannerMode = 'soft' | 'hard';

interface ActiveRouteMeta {
  currentUrl: string;
  requireVerified: boolean;
}

export interface EmailVerificationGateBannerVm {
  mode: BannerMode;
  title: string;
  message: string;
  email: string | null;
  ctaLabel: string;
  ctaRoute: string[];
  ctaQueryParams: Record<string, string>;
  showResend: boolean;
  currentUrl: string;
}

@Injectable({ providedIn: 'root' })
export class EmailVerificationGateFacade {
  private readonly access = inject(AccessControlService);
  private readonly session = inject(AuthSessionService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly router = inject(Router);
  private readonly notify = inject(ErrorNotificationService);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);
  private readonly emailVerificationService = inject(EmailVerificationService);

  private readonly resendClick$ = new Subject<void>();
  private lastNotifyAt = 0;

  /**
   * Meta da rota ativa:
   * - currentUrl normalizada;
   * - requireVerified vindo do snapshot mais profundo da rota.
   */
  private readonly activeRouteMeta$: Observable<ActiveRouteMeta> =
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      startWith(null),
      map(() => this.readActiveRouteMeta()),
      distinctUntilChanged(
        (a, b) =>
          a.currentUrl === b.currentUrl &&
          a.requireVerified === b.requireVerified
      ),
      shareReplay({ bufferSize: 1, refCount: true }),
      catchError((err) => {
        this.reportSilent(err, 'EmailVerificationGateFacade.activeRouteMeta$');

        return of({
          currentUrl: this.normalizeUrl(this.router.url),
          requireVerified: false,
        });
      })
    );

  readonly vm$: Observable<EmailVerificationGateBannerVm | null> =
    combineLatest([
      this.access.isAuthenticated$,
      this.access.profileCompleted$,
      this.access.emailVerified$,
      this.access.inRegistrationFlow$,
      this.session.authUser$.pipe(startWith(null)),
      this.currentUserStore.user$.pipe(startWith(undefined)),
      this.activeRouteMeta$,
    ]).pipe(
      map(
        ([
          isAuthenticated,
          profileCompleted,
          emailVerified,
          inRegistrationFlow,
          authUser,
          appUser,
          routeMeta,
        ]) => {
          const cleanUrl = routeMeta.currentUrl;
          const appUserVerified =
            appUser !== undefined && appUser !== null && appUser.emailVerified === true;
          const verified =
            emailVerified === true ||
            authUser?.emailVerified === true ||
            appUserVerified;

          if (!isAuthenticated) return null;

          /**
           * Prioridade:
           * perfil incompleto deve ser tratado pelo fluxo de onboarding/finalização,
           * não pelo banner de e-mail.
           */
          if (!profileCompleted) return null;

          if (verified) return null;
          if (inRegistrationFlow) return null;
          if (this.shouldHideBanner(cleanUrl)) return null;

          const mode: BannerMode = routeMeta.requireVerified ? 'hard' : 'soft';

          const ctaQueryParams: Record<string, string> = {
            redirectTo: this.normalizeRedirectTarget(this.router.url),
          };

          if (mode === 'hard') {
            ctaQueryParams['autocheck'] = '1';
            ctaQueryParams['reason'] = 'email_unverified';
          }

          return {
            mode,

            title:
              mode === 'hard'
                ? 'Verifique seu e-mail para continuar'
                : 'Seu e-mail ainda não foi verificado',

            message:
              mode === 'hard'
                ? 'Esta área exige uma conta com e-mail verificado.'
                : 'Verificar seu e-mail aumenta a confiança da sua conta e libera alguns recursos da plataforma.',

            email: authUser?.email?.trim() || null,

            ctaLabel: mode === 'hard' ? 'Verificar agora' : 'Verificar e-mail',

            ctaRoute: ['/register/welcome'],
            ctaQueryParams,

            showResend: true,
            currentUrl: cleanUrl,
          };
        }
      ),
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
      shareReplay({ bufferSize: 1, refCount: true }),
      catchError((err) => {
        this.reportSilent(err, 'EmailVerificationGateFacade.vm$');
        return of(null);
      })
    );

  resend(): void {
    this.resendClick$.next();
  }

  readonly resendEffect$ = this.resendClick$
    .pipe(
      exhaustMap(() =>
        this.emailVerificationService.resendVerificationEmail().pipe(
          tap(() => {
            this.notify.showSuccess('E-mail de verificação reenviado.');
          }),
          catchError((err) => {
            this.reportSilent(err, 'EmailVerificationGateFacade.resendEffect$');
            this.notifyOnce('Não foi possível reenviar o e-mail de verificação.');
            return of(void 0);
          })
        )
      )
    )
    .subscribe();

  private readActiveRouteMeta(): ActiveRouteMeta {
    const leaf = this.findDeepestPrimary(this.router.routerState.snapshot.root);

    return {
      currentUrl: this.normalizeUrl(this.router.url),
      requireVerified: leaf.data?.['requireVerified'] === true,
    };
  }

  private findDeepestPrimary(snapshot: ActivatedRouteSnapshot): ActivatedRouteSnapshot {
    let current = snapshot;

    while (current.firstChild) {
      current = current.firstChild;
    }

    return current;
  }

  private shouldHideBanner(url: string): boolean {
    return (
      /^\/login(\/|$)/.test(url) ||
      /^\/register(\/|$)/.test(url) ||
      /^\/post-verification\/action(\/|$)/.test(url) ||
      /^\/__\/auth\/action(\/|$)/.test(url)
    );
  }

  private normalizeUrl(url: string | null | undefined): string {
    return (url ?? '').trim().split('?')[0].split('#')[0];
  }

  private normalizeRedirectTarget(url: string | null | undefined): string {
    const clean = (url ?? '').trim();

    if (!clean) return '/dashboard/principal';
    if (!clean.startsWith('/') || clean.startsWith('//')) {
      return '/dashboard/principal';
    }

    return clean;
  }

  private reportSilent(err: unknown, context: string): void {
    try {
      const e = err instanceof Error ? err : new Error(context);

      (e as any).silent = true;
      (e as any).context = context;
      (e as any).original = err;
      (e as any).skipUserNotification = true;

      this.globalErrorHandler.handleError(e);
    } catch {
      // noop
    }
  }

  private notifyOnce(message: string): void {
    const now = Date.now();

    if (now - this.lastNotifyAt > 15_000) {
      this.lastNotifyAt = now;
      this.notify.showError(message);
    }
  }
}
