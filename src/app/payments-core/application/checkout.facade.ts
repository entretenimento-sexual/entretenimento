// src/app/payments-core/application/checkout.facade.ts
// ====================================================================
// CHECKOUT FACADE
//
// Responsabilidades:
// - ler o plano vindo da rota (?plan=...)
// - carregar os dados do plano selecionado
// - iniciar a sessão de checkout via BillingRepository
// - distinguir plano inválido, falha de carregamento e checkout indisponível
// - centralizar feedback de erro e contexto técnico
// ==================================================================
import { Injectable, inject, isDevMode } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  BehaviorSubject,
  combineLatest,
  from,
  Observable,
  of,
} from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import { BillingPlan } from '../domain/models/billing-plan.model';
import { BillingRepository } from '../infrastructure/repositories/billing.repository';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import {
  normalizeSubscriptionFlowContext,
  subscriptionFlowQueryParams,
} from 'src/app/subscriptions/domain/subscription-flow-context.model';

export type CheckoutStartResult =
  | { status: 'ready'; checkoutUrl: string }
  | { status: 'unavailable' }
  | { status: 'error' };

@Injectable()
export class CheckoutFacade {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly billingRepository = inject(BillingRepository);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly planLoadFailedSubject = new BehaviorSubject(false);

  readonly planLoadFailed$ = this.planLoadFailedSubject.pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly planKey$ = this.route.queryParamMap.pipe(
    map((params) => (params.get('plan') ?? '').trim().toLowerCase()),
    distinctUntilChanged(),
    tap((planKey) => {
      this.debug('planKey$ atualizado', { planKey });
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly flowContext$ = this.route.queryParamMap.pipe(
    map((params) =>
      normalizeSubscriptionFlowContext({
        minimumRole: params.get('minimumRole'),
        returnUrl: params.get('returnUrl'),
      })
    ),
    distinctUntilChanged((previous, current) =>
      previous.minimumRole === current.minimumRole
      && previous.returnUrl === current.returnUrl
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly plan$: Observable<BillingPlan | null> = this.planKey$.pipe(
    switchMap((planKey) => {
      this.planLoadFailedSubject.next(false);

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
          this.planLoadFailedSubject.next(true);
          this.reportError(
            error,
            'Não foi possível carregar o plano selecionado.',
            'loadPlan$',
            false
          );
          return of(null);
        })
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  startCheckout$(): Observable<CheckoutStartResult> {
    return combineLatest([this.plan$, this.flowContext$]).pipe(
      take(1),
      switchMap(([plan, flowContext]) => {
        if (!plan) {
          this.debug('startCheckout$ sem plano válido');
          return of<CheckoutStartResult>({ status: 'unavailable' });
        }

        this.debug('startCheckout$ iniciando sessão', {
          planId: plan.id,
          planKey: plan.key,
        });

        return this.billingRepository.createPlatformCheckoutSession$(
          plan,
          flowContext
        ).pipe(
          map((session): CheckoutStartResult =>
            session?.checkoutUrl
              ? { status: 'ready', checkoutUrl: session.checkoutUrl }
              : { status: 'unavailable' }
          )
        );
      }),
      tap((result) => {
        this.debug('startCheckout$ resultado', { status: result.status });
      }),
      catchError((error) => {
        this.reportError(
          error,
          this.resolveCheckoutUserMessage(error),
          'startCheckout$',
          true
        );
        return of<CheckoutStartResult>({ status: 'error' });
      })
    );
  }

  goBackToPlans(): Observable<boolean> {
    this.debug('goBackToPlans()');
    return this.flowContext$.pipe(
      take(1),
      switchMap((flowContext) => from(
        this.router.navigate(['/subscription-plan'], {
          queryParams: subscriptionFlowQueryParams(flowContext),
        })
      )),
      catchError((error) => {
        this.reportError(
          error,
          'Falha ao voltar para os planos.',
          'goBackToPlans',
          true
        );
        return of(false);
      })
    );
  }

  private resolveCheckoutUserMessage(error: unknown): string {
    const details = (error as { details?: unknown } | null)?.details;
    const reason = details && typeof details === 'object'
      ? String((details as Record<string, unknown>)['reason'] ?? '')
      : '';

    if (reason === 'downgrade_requires_next_cycle') {
      return 'A redução de plano ficará disponível quando puder ser programada para o próximo ciclo.';
    }

    return 'Não foi possível iniciar o checkout.';
  }

  private reportError(
    error: unknown,
    userMessage: string,
    operation: string,
    notifyUser: boolean
  ): void {
    if (notifyUser) {
      try {
        this.errorNotifier.showError(userMessage);
      } catch {
        // O diagnóstico central permanece ativo.
      }
    }

    try {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));

      (normalizedError as any).context = {
        feature: 'checkout',
        operation,
        scope: 'CheckoutFacade',
        op: operation,
      };
      (normalizedError as any).skipUserNotification = true;

      this.globalError.handleError(normalizedError);
    } catch {
      // Observabilidade não pode interromper o checkout.
    }
  }

  private debug(message: string, extra?: unknown): void {
    if (!isDevMode()) return;
    console.debug('[CheckoutFacade]', message, extra ?? '');
  }
}
