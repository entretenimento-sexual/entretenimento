//src\app\core\services\autentication\auth\email-verification-gate.facade.ts
import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Observable, combineLatest, of } from 'rxjs';
import { catchError, distinctUntilChanged, filter, map, shareReplay, startWith, take } from 'rxjs/operators';

import { CurrentUserStoreService } from './current-user-store.service';
import { EmailVerificationService } from '../register/email-verification.service';
import { ErrorNotificationService } from '../../error-handler/error-notification.service';

export interface EmailVerificationGateVm {
  visible: boolean;
  email: string | null;
  currentUrl: string;
  message: string;
  ctaLabel: string;
}

@Injectable({ providedIn: 'root' })
export class EmailVerificationGateFacade {
  private readonly userStore = inject(CurrentUserStoreService);
  private readonly router = inject(Router);
  private readonly emailVerification = inject(EmailVerificationService);
  private readonly notifier = inject(ErrorNotificationService);

  readonly vm$: Observable<EmailVerificationGateVm | null> = combineLatest([
    this.userStore.user$.pipe(startWith(null)),
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects || e.url),
      startWith(this.router.url || '/'),
      distinctUntilChanged()
    ),
  ]).pipe(
    map(([user, url]) => {
      const emailVerified = user?.emailVerified === true;
      const email = user?.email ?? null;
      const logged = !!user?.uid;

      const inRegisterFlow = /^\/register(\/|$)/.test(url);
      const sensitiveArea = /^(\/dashboard|\/preferencias|\/chat|\/media|\/conta)(\/|$)/.test(url);

      if (!logged || emailVerified || inRegisterFlow || !sensitiveArea) {
        return null;
      }

      return {
        visible: true,
        email,
        currentUrl: url,
        message:
          'Verifique seu e-mail para liberar descoberta, compatibilidade e outras áreas sensíveis da plataforma.',
        ctaLabel: 'Confirmar e-mail',
      };
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  resend(): void {
    this.emailVerification
      .resendVerificationEmail()
      .pipe(
        take(1),
        catchError((err) => {
          this.notifier.showError('Não foi possível reenviar o e-mail agora.');
          return of(null);
        })
      )
      .subscribe((message) => {
        if (message) {
          this.notifier.showSuccess(message);
        }
      });
  }
}