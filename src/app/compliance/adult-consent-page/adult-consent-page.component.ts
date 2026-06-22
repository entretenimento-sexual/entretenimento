import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { of } from 'rxjs';
import { catchError, finalize, take } from 'rxjs/operators';

import { AdultConsentService } from 'src/app/core/services/compliance/adult-consent.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import {
  acceptAdultContentConsent,
  clearAdultContentConsent,
} from 'src/app/core/guards/compliance/adult-content-consent.storage';

@Component({
  selector: 'app-adult-consent-page',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './adult-consent-page.component.html',
  styleUrls: ['./adult-consent-page.component.css'],
})
export class AdultConsentPageComponent {
  readonly redirectTo = this.resolveRedirectTo();

  isSaving = false;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly adultConsent: AdultConsentService,
    private readonly errorNotifier: ErrorNotificationService,
  ) {}

  accept(): void {
    if (this.isSaving) {
      return;
    }

    if (!acceptAdultContentConsent()) {
      this.errorNotifier.showError('Não foi possível salvar sua confirmação neste navegador.');
      return;
    }

    this.isSaving = true;

    this.adultConsent.acceptCurrentConsent$()
      .pipe(
        take(1),
        catchError(() => {
          this.errorNotifier.showWarning('Confirmação local salva. Sincronização pendente.', 4200);
          return of(undefined);
        }),
        finalize(() => {
          this.isSaving = false;
        })
      )
      .subscribe(() => {
        this.router.navigateByUrl(this.redirectTo).catch(() => {
          this.router.navigate(['/dashboard/principal']).catch(() => undefined);
        });
      });
  }

  decline(): void {
    clearAdultContentConsent();
    this.errorNotifier.showWarning('Acesso permitido apenas para maiores de 18 anos.', 4200);
    this.router.navigate(['/login']).catch(() => undefined);
  }

  private resolveRedirectTo(): string {
    const value = String(this.route.snapshot.queryParamMap.get('redirectTo') ?? '').trim();

    if (!value || !value.startsWith('/') || value.startsWith('//')) {
      return '/dashboard/principal';
    }

    if (value.startsWith('/login') || value.startsWith('/register')) {
      return '/dashboard/principal';
    }

    return value;
  }
}
