// src/app/payments-core/application/billing-return.facade.ts
// Não esquecer comentários explicativos e ferramentas de debug
import { Injectable, inject, isDevMode } from '@angular/core';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { from, Observable, of, timer } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
  take,
} from 'rxjs/operators';

import { BillingRepository } from '../infrastructure/repositories/billing.repository';
import {
  BillingReturnQuery,
  BillingReturnVm,
  ProcessBillingReturnResult,
} from '../domain/models/billing-return.model';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';

@Injectable()
export class BillingReturnFacade {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly authSession = inject(AuthSessionService);
  private readonly billingRepository = inject(BillingRepository);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);

  readonly query$ = this.route.queryParamMap.pipe(
    map((params) => this.mapQuery(params)),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly vm$: Observable<BillingReturnVm> = this.query$.pipe(
    switchMap((query) => this.processQuery$(query)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  retry(): Promise<boolean> {
    return this.router.navigate(['/subscription-plan']);
  }

  private processQuery$(query: BillingReturnQuery): Observable<BillingReturnVm> {
    const normalizedBilling = (query.billing ?? '')
      .trim()
      .toLowerCase()
      .split('?')[0];

    if (!normalizedBilling || !query.scope) {
      return of(
        this.buildVm({
          status: 'failed',
          title: 'Retorno inválido',
          description: 'Não foi possível identificar o resultado do pagamento.',
          detail: 'Os parâmetros de retorno vieram incompletos.',
          busy: false,
          primaryActionLabel: 'Voltar aos planos',
          secondaryActionLabel: null,
        })
      );
    }

    if (normalizedBilling === 'cancel' || normalizedBilling === 'canceled') {
      return of(
        this.buildVm({
          status: 'canceled',
          title: 'Pagamento cancelado',
          description: 'Nenhuma cobrança foi concluída.',
          detail: 'Você pode revisar o plano e tentar novamente quando quiser.',
          busy: false,
          primaryActionLabel: 'Voltar aos planos',
          secondaryActionLabel: null,
        })
      );
    }

    return this.ensureAuthReady$().pipe(
      switchMap((uid) => {
        if (!uid) {
          return this.redirectToLogin$(query).pipe(
            map(() =>
              this.buildVm({
                status: 'login_required',
                title: 'Entre para concluir',
                description: 'Sua sessão não estava pronta no retorno do pagamento.',
                detail: 'Após o login, o app retomará automaticamente o processamento do retorno.',
                busy: true,
                primaryActionLabel: null,
                secondaryActionLabel: null,
              })
            )
          );
        }

        return this.billingRepository.processBillingReturn$({
          billing: normalizedBilling,
          scope: query.scope!,
          mockProvider: query.mockProvider,
          providerSessionId: query.providerSessionId,
          checkoutSessionId: query.checkoutSessionId,
        }).pipe(
          switchMap((result) => this.handleProcessingResult$(result)),
          catchError((error) => {
            this.handleError(
              error,
              'Falha ao confirmar o pagamento com a plataforma.'
            );

            return of(
              this.buildVm({
                status: 'failed',
                title: 'Falha ao confirmar pagamento',
                description: 'Não foi possível concluir a confirmação agora.',
                detail: 'Você pode voltar aos planos ou tentar novamente em instantes.',
                busy: false,
                primaryActionLabel: 'Voltar aos planos',
                secondaryActionLabel: null,
              })
            );
          })
        );
      })
    );
  }

  private ensureAuthReady$(): Observable<string | null> {
    return from(this.authSession.whenReady()).pipe(
      switchMap(() => this.authSession.uid$.pipe(take(1)))
    );
  }

  private handleProcessingResult$(
    result: ProcessBillingReturnResult | null
  ): Observable<BillingReturnVm> {
    if (!result) {
      return of(
        this.buildVm({
          status: 'failed',
          title: 'Resposta vazia',
          description: 'A plataforma não recebeu um estado válido do retorno.',
          detail: 'O pagamento pode ainda estar em processamento.',
          busy: false,
          primaryActionLabel: 'Voltar aos planos',
          secondaryActionLabel: null,
        })
      );
    }

    if (result.status === 'canceled') {
      return of(
        this.buildVm({
          status: 'canceled',
          title: 'Pagamento cancelado',
          description: 'Nenhuma cobrança foi concluída.',
          detail: result.message ?? 'Você pode tentar novamente quando quiser.',
          busy: false,
          primaryActionLabel: 'Voltar aos planos',
          secondaryActionLabel: null,
        })
      );
    }

    if (result.status === 'failed') {
      return of(
        this.buildVm({
          status: 'failed',
          title: 'Pagamento não confirmado',
          description: 'A cobrança não foi confirmada.',
          detail: result.message ?? 'Revise os dados de pagamento e tente novamente.',
          busy: false,
          primaryActionLabel: 'Voltar aos planos',
          secondaryActionLabel: null,
        })
      );
    }

    if (result.status === 'processing') {
      return this.pollBillingSnapshotAndFinish$();
    }

    return this.finishGrantedFlow$(result);
  }

  private pollBillingSnapshotAndFinish$(): Observable<BillingReturnVm> {
    return timer(1200).pipe(
      switchMap(() => this.billingRepository.getMyBillingSnapshot$()),
      switchMap((snapshot) => {
        const granted =
          snapshot?.isSubscriber === true &&
          !!String(snapshot?.role ?? snapshot?.tier ?? '').trim();

        if (!granted) {
          return of(
            this.buildVm({
              status: 'processing',
              title: 'Pagamento em processamento',
              description: 'Estamos aguardando a confirmação final da sua assinatura.',
              detail: 'Pode levar alguns instantes até a atualização do seu acesso.',
              busy: true,
              primaryActionLabel: null,
              secondaryActionLabel: null,
            })
          );
        }

        return this.navigateAfterGranted$().pipe(
          map(() =>
            this.buildVm({
              status: 'granted',
              title: 'Assinatura confirmada',
              description: 'Seu acesso premium foi atualizado com sucesso.',
              detail: 'Você será redirecionado automaticamente.',
              busy: true,
              primaryActionLabel: null,
              secondaryActionLabel: null,
            })
          )
        );
      })
    );
  }

  private finishGrantedFlow$(
    result: ProcessBillingReturnResult
  ): Observable<BillingReturnVm> {
    return this.navigateAfterGranted$(result.redirectTo ?? null).pipe(
      map(() =>
        this.buildVm({
          status: 'granted',
          title: 'Pagamento confirmado',
          description: 'Seu novo acesso já foi liberado na plataforma.',
          detail: result.message ?? 'Você será redirecionado automaticamente.',
          busy: true,
          primaryActionLabel: null,
          secondaryActionLabel: null,
        })
      )
    );
  }

  private navigateAfterGranted$(
    redirectTo?: string | null
  ): Observable<boolean> {
    const target = redirectTo?.trim() || '/conta';

    return from(
      this.router.navigateByUrl(target, {
        replaceUrl: true,
      })
    );
  }

  private redirectToLogin$(query: BillingReturnQuery): Observable<boolean> {
    const redirectTo = this.buildReturnUrl(query);

    return from(
      this.router.navigate(['/login'], {
        queryParams: { redirectTo },
        replaceUrl: true,
      })
    );
  }

  private buildReturnUrl(query: BillingReturnQuery): string {
    const params = new URLSearchParams();

    if (query.billing) params.set('billing', query.billing);
    if (query.scope) params.set('scope', query.scope);
    if (query.mockProvider) params.set('mockProvider', query.mockProvider);
    if (query.providerSessionId) {
      params.set('providerSessionId', query.providerSessionId);
    }
    if (query.checkoutSessionId) {
      params.set('checkoutSessionId', query.checkoutSessionId);
    }

    return `/billing/return?${params.toString()}`;
  }

  private mapQuery(params: ParamMap): BillingReturnQuery {
    return {
      billing: params.get('billing'),
      scope: params.get('scope'),
      mockProvider: params.get('mockProvider'),
      providerSessionId: params.get('providerSessionId'),
      checkoutSessionId: params.get('checkoutSessionId'),
    };
  }

  private buildVm(vm: BillingReturnVm): BillingReturnVm {
    return vm;
  }

  private handleError(error: unknown, userMessage: string): void {
    try {
      this.errorNotifier.showError(userMessage);
    } catch {
      // noop
    }

    try {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));

      (normalizedError as any).context = {
        scope: 'BillingReturnFacade',
      };
      (normalizedError as any).skipUserNotification = true;

      this.globalErrorHandler.handleError(normalizedError);
    } catch {
      // noop
    }

    if (isDevMode()) {
      console.error('[BillingReturnFacade]', error);
    }
  }
}