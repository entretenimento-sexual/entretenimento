// src/app/payments-core/application/billing-return.facade.ts
// -----------------------------------------------------------------------------
// BILLING RETURN FACADE
// -----------------------------------------------------------------------------
//
// Orquestra a experiência visual após o retorno do checkout.
//
// Responsabilidade:
// - interpretar parâmetros mínimos da URL;
// - aguardar autenticação;
// - consultar o backend sobre a sessão criada;
// - acompanhar entitlement ativo enquanto o pagamento estiver processando;
// - navegar somente quando o backend confirmar acesso.
//
// Segurança:
// - query string não confirma pagamento;
// - não existe provider confiável vindo da URL;
// - não existe sessão externa confiável vindo da URL;
// - o acesso só é considerado concedido quando o backend retornar granted ou
//   quando getMyBillingSnapshot confirmar entitlement de plataforma.
//
// Reatividade:
// - polling limitado para gateways reais, onde o webhook pode chegar depois
//   do redirecionamento do usuário;
// - polling termina ao confirmar acesso ou ao atingir limite de espera.
//
// Debug opt-in:
// - ativar no navegador:
//   localStorage.setItem('debug.billing', '1'); location.reload();
// - desativar:
//   localStorage.removeItem('debug.billing'); location.reload();

import { Injectable, inject, isDevMode } from '@angular/core';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { concat, from, Observable, of, race, timer } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  map,
  shareReplay,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import { BillingRepository } from '../infrastructure/repositories/billing.repository';
import {
  BillingGrantedRole,
  BillingReturnQuery,
  BillingReturnVm,
  BillingSnapshotResult,
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

  private readonly pollIntervalMs = 1500;
  private readonly pollTimeoutMs = 30_000;
  private readonly debugEnabled = this.resolveDebugEnabled();

  readonly query$ = this.route.queryParamMap.pipe(
    map((params) => this.mapQuery(params)),
    distinctUntilChanged((previous, current) =>
      this.isSameQuery(previous, current)
    ),
    tap((query) =>
      this.dbg('return query received', {
        billing: query.billing,
        scope: query.scope,
        hasCheckoutSessionId: !!query.checkoutSessionId,
      })
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly vm$: Observable<BillingReturnVm> = this.query$.pipe(
    switchMap((query) => this.processQuery$(query)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  retry(): Promise<boolean> {
    return this.router.navigate(['/subscription-plan']);
  }

  private processQuery$(
    query: BillingReturnQuery
  ): Observable<BillingReturnVm> {
    const normalizedBilling = this.normalizeBillingSignal(query.billing);
    const normalizedScope = String(query.scope ?? '').trim();

    if (!normalizedBilling || !normalizedScope) {
      return of(
        this.buildVm({
          status: 'failed',
          title: 'Retorno inválido',
          description: 'Não foi possível identificar o retorno da assinatura.',
          detail: 'Os parâmetros necessários não foram informados.',
          busy: false,
          primaryActionLabel: 'Voltar aos planos',
          secondaryActionLabel: null,
        })
      );
    }

    /**
     * Cancelamento exibido ao usuário não concede nem remove acesso.
     *
     * Em operação real, o estado financeiro definitivo será estabelecido pelo
     * provider/webhook validado; não confiamos em cancelamento vindo apenas da
     * URL como evento contábil.
     */
    if (normalizedBilling === 'cancel') {
      return of(
        this.buildVm({
          status: 'canceled',
          title: 'Pagamento cancelado',
          description: 'Nenhuma assinatura foi confirmada por este retorno.',
          detail: 'Você pode revisar o plano e tentar novamente.',
          busy: false,
          primaryActionLabel: 'Voltar aos planos',
          secondaryActionLabel: null,
        })
      );
    }

    if (!query.checkoutSessionId) {
      return of(
        this.buildVm({
          status: 'failed',
          title: 'Sessão não localizada',
          description: 'Não foi possível identificar a sessão de checkout.',
          detail: 'Retorne aos planos e inicie uma nova tentativa.',
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
                title: 'Entre para continuar',
                description:
                  'Sua sessão precisa estar ativa para consultar o estado da assinatura.',
                detail:
                  'Após o login, o app retomará automaticamente esta consulta.',
                busy: true,
                primaryActionLabel: null,
                secondaryActionLabel: null,
              })
            )
          );
        }

        return this.billingRepository
          .processBillingReturn$({
            billing: normalizedBilling,
            scope: normalizedScope,
            checkoutSessionId: query.checkoutSessionId!,
          })
          .pipe(
            tap((result) =>
              this.dbg('processBillingReturn result', {
                status: result?.status ?? null,
                accessGranted: result?.accessGranted === true,
                role: result?.role ?? null,
              })
            ),
            switchMap((result) => this.handleProcessingResult$(result)),
            catchError((error: unknown) => {
              this.handleError(
                error,
                'Falha ao consultar o estado da assinatura.'
              );

              return of(
                this.buildVm({
                  status: 'failed',
                  title: 'Não foi possível consultar a assinatura',
                  description:
                    'O estado da sua assinatura não pôde ser obtido agora.',
                  detail:
                    'Você pode voltar aos planos ou tentar novamente em instantes.',
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
          title: 'Resposta indisponível',
          description:
            'A plataforma não recebeu um estado válido da assinatura.',
          detail: 'A confirmação pode ainda estar pendente.',
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
          description: 'Nenhuma assinatura foi confirmada.',
          detail: result.message ?? 'Você pode tentar novamente.',
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
          detail:
            result.message ?? 'Revise a tentativa e tente novamente.',
          busy: false,
          primaryActionLabel: 'Voltar aos planos',
          secondaryActionLabel: null,
        })
      );
    }

    if (
      result.status === 'granted' &&
      result.accessGranted === true &&
      this.isBillingGrantedRole(result.role)
    ) {
      return this.finishGrantedFlow$(result);
    }

    /**
     * Em cloud, este é o caminho normal após retorno do gateway:
     * o usuário voltou à aplicação, mas o webhook ainda pode estar chegando.
     *
     * No Emulator, também cobre eventual resposta intermediária.
     */
    return this.pollBillingSnapshotAndFinish$();
  }

  private pollBillingSnapshotAndFinish$(): Observable<BillingReturnVm> {
    const processingVm = this.buildVm({
      status: 'processing',
      title: 'Pagamento em processamento',
      description: 'Estamos aguardando a confirmação da sua assinatura.',
      detail: 'A atualização do acesso pode levar alguns instantes.',
      busy: true,
      primaryActionLabel: null,
      secondaryActionLabel: null,
    });

    const granted$ = timer(0, this.pollIntervalMs).pipe(
      tap((attempt) =>
        this.dbg('billing snapshot poll', {
          attempt: attempt + 1,
        })
      ),
      switchMap(() =>
        this.billingRepository.getMyBillingSnapshot$().pipe(
          catchError((error: unknown) => {
            /**
             * Erro transitório de polling não gera toast repetido.
             * O diagnóstico permanece disponível no modo debug e o fluxo pode
             * continuar tentando até o timeout controlado.
             */
            this.dbg('billing snapshot poll failed', {
              message:
                error instanceof Error ? error.message : String(error),
            });

            return of(null);
          })
        )
      ),
      filter(
        (snapshot): snapshot is BillingSnapshotResult =>
          this.hasGrantedPlatformSubscription(snapshot)
      ),
      take(1),
      switchMap((snapshot) =>
        this.navigateAfterGranted$().pipe(
          map(() =>
            this.buildVm({
              status: 'granted',
              title: 'Assinatura confirmada',
              description: 'Seu acesso foi atualizado com sucesso.',
              detail: `Plano ativo: ${snapshot.role ?? snapshot.tier}.`,
              busy: true,
              primaryActionLabel: null,
              secondaryActionLabel: null,
            })
          )
        )
      )
    );

    const timeout$ = timer(this.pollTimeoutMs).pipe(
      map(() =>
        this.buildVm({
          status: 'processing',
          title: 'Confirmação ainda pendente',
          description:
            'Ainda não recebemos a confirmação final da assinatura.',
          detail:
            'Você pode retornar aos planos ou consultar sua conta novamente em instantes.',
          busy: false,
          primaryActionLabel: 'Voltar aos planos',
          secondaryActionLabel: null,
        })
      )
    );

    return concat(
      of(processingVm),
      race(granted$, timeout$)
    );
  }

  private finishGrantedFlow$(
    result: ProcessBillingReturnResult
  ): Observable<BillingReturnVm> {
    return this.navigateAfterGranted$(result.redirectTo ?? null).pipe(
      map(() =>
        this.buildVm({
          status: 'granted',
          title: 'Assinatura confirmada',
          description: 'Seu novo acesso já foi liberado na plataforma.',
          detail:
            result.message ?? 'Você será redirecionado automaticamente.',
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

  private redirectToLogin$(
    query: BillingReturnQuery
  ): Observable<boolean> {
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

    if (query.billing) {
      params.set('billing', query.billing);
    }

    if (query.scope) {
      params.set('scope', query.scope);
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
      checkoutSessionId: params.get('checkoutSessionId'),
    };
  }

  private normalizeBillingSignal(
    rawValue: string | null
  ): 'success' | 'failed' | 'cancel' | null {
    const value = String(rawValue ?? '')
      .trim()
      .toLowerCase()
      .split('?')[0];

    if (value === 'success' || value === 'paid') {
      return 'success';
    }

    if (value === 'failed' || value === 'error') {
      return 'failed';
    }

    if (
      value === 'cancel' ||
      value === 'canceled' ||
      value === 'cancelled'
    ) {
      return 'cancel';
    }

    return null;
  }

  private hasGrantedPlatformSubscription(
    snapshot: BillingSnapshotResult | null
  ): boolean {
    const role = snapshot?.role ?? snapshot?.tier ?? null;

    return (
      snapshot?.isSubscriber === true &&
      snapshot?.entitlements?.includes('platform_subscription') === true &&
      this.isBillingGrantedRole(role)
    );
  }

  private isBillingGrantedRole(
    value: unknown
  ): value is BillingGrantedRole {
    return value === 'basic' || value === 'premium' || value === 'vip';
  }

  private isSameQuery(
    previous: BillingReturnQuery,
    current: BillingReturnQuery
  ): boolean {
    return (
      previous.billing === current.billing &&
      previous.scope === current.scope &&
      previous.checkoutSessionId === current.checkoutSessionId
    );
  }

  private buildVm(vm: BillingReturnVm): BillingReturnVm {
    return vm;
  }

  private resolveDebugEnabled(): boolean {
    if (!isDevMode() || typeof window === 'undefined') {
      return false;
    }

    try {
      return window.localStorage.getItem('debug.billing') === '1';
    } catch {
      return false;
    }
  }

  private dbg(message: string, payload?: unknown): void {
    if (!this.debugEnabled) {
      return;
    }

    console.debug(`[BillingReturnFacade] ${message}`, payload ?? '');
  }

  private handleError(error: unknown, userMessage: string): void {
    try {
      this.errorNotifier.showError(userMessage);
    } catch {
      // Falha no toast não pode quebrar o fluxo de billing.
    }

    try {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));

      (normalizedError as Error & {
        context?: { scope: string };
        skipUserNotification?: boolean;
      }).context = {
        scope: 'BillingReturnFacade',
      };

      (normalizedError as Error & {
        skipUserNotification?: boolean;
      }).skipUserNotification = true;

      this.globalErrorHandler.handleError(normalizedError);
    } catch {
      // O handler global é observacional; não pode interromper a UX.
    }

    this.dbg('billing return error', {
      message:
        error instanceof Error ? error.message : String(error),
    });
  }
}//linha542