// src/app/subscriptions/application/subscription-checkout.facade.ts
// ============================================================================
// SUBSCRIPTION CHECKOUT FACADE
//
// Responsabilidades:
// - interpretar o retorno do checkout vindo pela URL
// - normalizar os query params de billing
// - marcar o sucesso do pagamento para a camada de UX
// - limpar os query params após o processamento
//
// Observações:
// - esta facade NÃO substitui confirmação de backend/webhook
// - nesta etapa ela organiza o retorno do front com previsibilidade
// - a sincronização fina de assinatura/entitlement pode ser plugada aqui depois
// ============================================================================

import { Injectable, inject, isDevMode } from '@angular/core';
import { ParamMap, Router } from '@angular/router';
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { from, Observable, combineLatest, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import { IncompleteProfileSubscriptionNoticeService } from './incomplete-profile-subscription-notice.service';

export interface SubscriptionCheckoutReturnState {
  billingRaw: string;
  billingNormalized: string;
  scope: string;
  mockProvider: string | null;
  isBillingSuccess: boolean;
  isPlatformSubscriptionScope: boolean;
  shouldProcessSuccessReturn: boolean;
}

@Injectable()
export class SubscriptionCheckoutFacade {
  private readonly router = inject(Router);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);
  private readonly noticeService = inject(IncompleteProfileSubscriptionNoticeService);

  readonly currentUser$ = this.currentUserStore.user$.pipe(
    map((user) => user ?? null),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  buildReturnState$(
    queryParamMap$: Observable<ParamMap>
  ): Observable<SubscriptionCheckoutReturnState> {
    return queryParamMap$.pipe(
      map((params) => {
        const billingRaw = (params.get('billing') ?? '').trim();
        const scope = (params.get('scope') ?? '').trim();
        const mockProvider = params.get('mockProvider');

        // tolera o retorno atual malformado:
        // billing=success?mockProvider=asaas
        const billingNormalized = billingRaw.toLowerCase().split('?')[0].trim();

        const isBillingSuccess = billingNormalized === 'success';
        const isPlatformSubscriptionScope = scope === 'platform_subscription';

        return {
          billingRaw,
          billingNormalized,
          scope,
          mockProvider,
          isBillingSuccess,
          isPlatformSubscriptionScope,
          shouldProcessSuccessReturn:
            isBillingSuccess && isPlatformSubscriptionScope,
        };
      }),
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  processSuccessfulReturn$(
    queryParamMap$: Observable<ParamMap>
  ): Observable<boolean> {
    return combineLatest([
      this.currentUser$,
      this.buildReturnState$(queryParamMap$),
    ]).pipe(
      take(1),
      switchMap(([user, returnState]) => {
        this.debug('processSuccessfulReturn$()', {
          uid: user?.uid ?? null,
          returnState,
        });

        if (!returnState.shouldProcessSuccessReturn) {
          return of(false);
        }

        if (!user?.uid) {
          this.debug('retorno ignorado: usuário indisponível');
          return this.clearBillingQueryParams$().pipe(map(() => false));
        }

        this.noticeService.hydrate(user.uid);
        this.noticeService.markPaymentSuccess(user.uid);

        return this.clearBillingQueryParams$().pipe(
          tap(() => {
            this.debug('retorno pós-pagamento processado', {
              uid: user.uid,
              scope: returnState.scope,
            });
          }),
          map(() => true)
        );
      }),
      catchError((error) => {
        this.globalErrorHandler.handleError(error);
        this.errorNotifier.showError(
          'Não foi possível processar o retorno da assinatura.'
        );
        return of(false);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private clearBillingQueryParams$(): Observable<boolean> {
    return from(
      this.router.navigate([], {
        queryParams: {
          billing: null,
          scope: null,
          mockProvider: null,
        },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      })
    );
  }

  private debug(message: string, extra?: unknown): void {
    if (!isDevMode()) return;
    console.debug('[SubscriptionCheckoutFacade]', message, extra ?? '');
  }
}