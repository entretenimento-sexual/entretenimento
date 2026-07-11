import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { EMPTY } from 'rxjs';
import { catchError, finalize, switchMap, take } from 'rxjs/operators';

import { LogoutService } from 'src/app/core/services/autentication/auth/logout.service';
import { AdultConsentService } from 'src/app/core/services/compliance/adult-consent.service';
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
        finalize(() => {
          this.isSaving = false;
        })
      )
      .subscribe((uid) => {
        const target = this.resolveRedirectTo(uid);

        this.router.navigateByUrl(target, { replaceUrl: true }).catch(() => {
          this.router
            .navigate(['/preferencias/editar', uid], { replaceUrl: true })
            .catch(() => undefined);
        });
      });
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
