import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { EMPTY, from } from 'rxjs';
import { catchError, finalize, switchMap, take } from 'rxjs/operators';

import { LogoutService } from 'src/app/core/services/autentication/auth/logout.service';
import { AdultConsentService } from 'src/app/core/services/compliance/adult-consent.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

@Component({
  selector: 'app-adult-consent-page',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './adult-consent-page.component.html',
  styleUrls: ['./adult-consent-page.component.css'],
})
export class AdultConsentPageComponent {
  isSaving = false;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly adultConsent: AdultConsentService,
    private readonly logout: LogoutService,
    private readonly applicationError: ApplicationErrorService,
    private readonly errorNotifier: ErrorNotificationService,
  ) {}

  accept(): void {
    if (this.isSaving) {
      return;
    }

    this.isSaving = true;

    this.adultConsent.acceptCurrentConsent$()
      .pipe(
        take(1),
        catchError(() => {
          this.errorNotifier.showError(
            'Não foi possível confirmar sua maioridade agora. Verifique a conexão e tente novamente.'
          );
          return EMPTY;
        }),
        switchMap((uid) => from(this.navigateAfterConsent(uid))),
        finalize(() => {
          this.isSaving = false;
        })
      )
      .subscribe();
  }

  decline(): void {
    if (this.isSaving) {
      return;
    }

    this.isSaving = true;

    this.adultConsent.clearCurrentConsentCache$()
      .pipe(
        switchMap(() => {
          this.errorNotifier.showWarning('Acesso permitido apenas para maiores de 18 anos.', 4200);
          return this.logout.logout$();
        }),
        take(1),
        catchError(() => {
          this.errorNotifier.showError(
            'Não foi possível encerrar sua sessão. Tente novamente.'
          );
          return EMPTY;
        }),
        finalize(() => {
          this.isSaving = false;
        })
      )
      .subscribe();
  }

  private async navigateAfterConsent(uid: string): Promise<void> {
    const target = this.resolveRedirectTo(uid);
    let primaryError: unknown = null;

    try {
      const navigated = await this.router.navigateByUrl(target, {
        replaceUrl: true,
      });

      if (navigated) {
        return;
      }

      primaryError = new Error(
        `[AdultConsentPageComponent] Router recusou a navegação para ${target}.`
      );
    } catch (error) {
      primaryError = error;
    }

    try {
      const fallbackNavigated = await this.router.navigate(
        ['/preferencias/editar', uid],
        { replaceUrl: true }
      );

      if (fallbackNavigated) {
        return;
      }

      this.reportNavigationFailure(
        primaryError,
        new Error(
          '[AdultConsentPageComponent] Router recusou a navegação de fallback.'
        ),
        target
      );
    } catch (fallbackError) {
      this.reportNavigationFailure(primaryError, fallbackError, target);
    }
  }

  private reportNavigationFailure(
    primaryError: unknown,
    fallbackError: unknown,
    target: string
  ): void {
    try {
      this.applicationError.report(primaryError, {
        feature: 'adult-consent',
        operation: 'navigateAfterConsent',
        fallbackMessage:
          'Sua confirmação de maioridade foi registrada, mas não foi possível avançar.',
        presentation: { surface: 'none', severity: 'error' },
        metadata: {
          scope: 'AdultConsentPageComponent',
          targetPath: String(target ?? '').split('?')[0].split('#')[0],
          fallbackNavigationFailed: fallbackError !== undefined && fallbackError !== null,
        },
      });
    } catch {
      // O diagnóstico não pode invalidar uma confirmação já persistida.
    }

    this.errorNotifier.showError(
      'Sua confirmação de maioridade foi registrada, mas não foi possível avançar. Recarregue a página e tente novamente.'
    );
  }

  private resolveRedirectTo(uid: string): string {
    const value = String(this.route.snapshot.queryParamMap.get('redirectTo') ?? '').trim();

    if (
      value &&
      value.startsWith('/') &&
      !value.startsWith('//') &&
      !value.startsWith('/login') &&
      !value.startsWith('/register') &&
      !value.startsWith('/adulto/confirmar')
    ) {
      return value;
    }

    return `/preferencias/editar/${encodeURIComponent(uid)}`;
  }
}
