// src/app/payments-core/application/checkout.facade.ts
// ====================================================================
// CHECKOUT FACADE
//
// Responsabilidades:
// - ler o plano vindo da rota (?plan=...)
// - carregar os dados do plano selecionado
// - iniciar a sessão de checkout via BillingRepository
// - centralizar feedback de erro e contexto técnico
//
// Observação arquitetural:
// - esta facade depende de ActivatedRoute, portanto faz mais sentido
//   ficar no escopo da tela de checkout, e não como singleton global.
// - por isso, ela não usa mais providedIn: 'root'.
// ==================================================================
import { Injectable, inject, isDevMode } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
  tap,
} from 'rxjs/operators';

import { BillingPlan } from '../domain/models/billing-plan.model';
import { BillingRepository } from '../infrastructure/repositories/billing.repository';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';

@Injectable()
export class CheckoutFacade {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly billingRepository = inject(BillingRepository);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  readonly planKey$ = this.route.queryParamMap.pipe(
    map((params) => (params.get('plan') ?? '').trim().toLowerCase()),
    distinctUntilChanged(),
    tap((planKey) => {
      this.debug('planKey$ atualizado', { planKey });
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly plan$: Observable<BillingPlan | null> = this.planKey$.pipe(
    switchMap((planKey) => {
      if (!planKey) {
        this.debug('plan$ sem planKey', { planKey });
        return of(null);
      }

      return this.billingRepository.getPlatformPlanByKey$(planKey).pipe(
        tap((plan) => {
          this.debug('plan$ carregado', {
            planKey,
            found: !!plan,
            planId: plan?.id ?? null,
          });
        }),
        catchError((error) => {
          this.reportError(
            error,
            'Não foi possível carregar o plano selecionado.',
            'loadPlan$'
          );
          return of(null);
        })
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  startCheckout$(): Observable<string | null> {
    return this.plan$.pipe(
      switchMap((plan) => {
        if (!plan) {
          this.debug('startCheckout$ sem plano válido');
          return of(null);
        }

        this.debug('startCheckout$ iniciando sessão', {
          planId: plan.id,
          planKey: plan.key,
        });

        return this.billingRepository.createPlatformCheckoutSession$(plan);
      }),
      map((session) => session?.checkoutUrl ?? null),
      tap((checkoutUrl) => {
        this.debug('startCheckout$ resultado', {
          hasCheckoutUrl: !!checkoutUrl,
        });
      }),
      catchError((error) => {
        this.reportError(
          error,
          'Não foi possível iniciar o checkout.',
          'startCheckout$'
        );
        return of(null);
      })
    );
  }

  goBackToPlans(): Promise<boolean> {
    this.debug('goBackToPlans()');
    return this.router.navigate(['/subscription-plan']);
  }

  private reportError(
    error: unknown,
    userMessage: string,
    op: string
  ): void {
    try {
      this.errorNotifier.showError(userMessage);
    } catch {
      // noop
    }

    try {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));

      (normalizedError as any).context = {
        scope: 'CheckoutFacade',
        op,
      };

      // Evita duplicar o feedback, já que a notificação ao usuário
      // foi disparada acima.
      (normalizedError as any).skipUserNotification = true;

      this.globalError.handleError(normalizedError);
    } catch {
      // noop
    }
  }

  private debug(message: string, extra?: unknown): void {
    if (!isDevMode()) return;
    console.debug('[CheckoutFacade]', message, extra ?? '');
  }
}