// src/app/account/application/account.facade.ts
// -----------------------------------------------------------------------------
// ACCOUNT FACADE
// -----------------------------------------------------------------------------
// - Combina Auth, perfil runtime e snapshot sanitizado de billing.
// - Não concede visualmente assinatura a partir de role/tier projetados.
// - Não anuncia senha, 2FA ou gestão de dispositivos sem evidência real.
// -----------------------------------------------------------------------------
import { Injectable, inject } from '@angular/core';
import { combineLatest, Observable, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  startWith,
} from 'rxjs/operators';

import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { BillingRepository } from 'src/app/payments-core/infrastructure/repositories/billing.repository';
import { BillingSnapshotResult } from 'src/app/payments-core/domain/models/billing-return.model';

import { AccountOverviewVm } from '../models/account-overview.model';

type PaidPlanKey = 'basic' | 'premium' | 'vip';

@Injectable({ providedIn: 'root' })
export class AccountFacade {
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly authSession = inject(AuthSessionService);
  private readonly billingRepository = inject(BillingRepository);
  private readonly globalError = inject(GlobalErrorHandlerService);

  private readonly billingSnapshot$ = this.authSession.readyUid$.pipe(
    distinctUntilChanged(),
    map((uid) => String(uid ?? '').trim() || null),
    // A callable só é consultada com sessão pronta.
    // Sem sessão, o snapshot é nulo e não concede acesso visual.
    // switchMap é importado dinamicamente abaixo pelo pipe nativo do RxJS.
    // Mantemos o fluxo como Observable, sem subscribe interno.
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    switchMapUid((uid, repository) =>
      uid ? repository.getMyBillingSnapshot$() : of(null),
      this.billingRepository
    ),
    catchError((error: unknown) => {
      this.reportSilent(error, 'loadBillingSnapshot');
      return of(null);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly vm$: Observable<AccountOverviewVm | null> = combineLatest([
    this.currentUserStore.user$.pipe(
      map((user): IUserDados | null => user ?? null),
      startWith(null)
    ),
    this.authSession.authUser$.pipe(
      map((authUser) => authUser ?? null),
      startWith(null)
    ),
    this.billingSnapshot$.pipe(startWith(null)),
  ]).pipe(
    map(([user, authUser, billingSnapshot]) => {
      if (!user && !authUser) return null;
      return this.buildVm(user, authUser, billingSnapshot);
    }),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private buildVm(
    user: IUserDados | null,
    authUser: any | null,
    billingSnapshot: BillingSnapshotResult | null
  ): AccountOverviewVm {
    const nickname = String(user?.nickname ?? '').trim() || null;
    const uid = String(user?.uid ?? authUser?.uid ?? '').trim() || null;
    const email = user?.email ?? authUser?.email ?? null;
    const emailVerified =
      user?.emailVerified === true || authUser?.emailVerified === true;

    const providerIds = (authUser?.providerData ?? [])
      .map((provider: any) => String(provider?.providerId ?? '').trim())
      .filter(Boolean);

    const googleLinked = providerIds.includes('google.com');
    const passwordConfigured = providerIds.includes('password');

    const memberSince =
      user?.registrationDate ??
      user?.createdAt ??
      user?.firstLogin ??
      null;

    const lastLoginAt = user?.lastLogin ?? null;
    const estado = String(user?.estado ?? '').trim();
    const municipio = String(user?.municipio ?? '').trim();

    const locationLabel =
      municipio && estado ? municipio : estado || 'Não informado';
    const locationDetails =
      municipio && estado
        ? `${municipio}, ${estado}, BR`
        : estado
          ? `${estado}, BR`
          : 'Localização não informada';

    const effectivePlanKey = this.resolveAuthoritativePlanKey(
      billingSnapshot
    );
    const subscriptionActive =
      billingSnapshot?.isSubscriber === true && effectivePlanKey !== null;
    const roleLabel = this.mapRoleLabel(user, effectivePlanKey);
    const activePlanLabel = subscriptionActive
      ? this.mapPaidPlanLabel(effectivePlanKey)
      : null;

    return {
      uid,
      nickname,
      profilePath: nickname ? `/perfil/${nickname}` : null,

      email,
      emailVerified,
      emailStatusLabel: emailVerified ? 'Verificado' : 'Não verificado',
      verificationHint: emailVerified
        ? 'Seu e-mail já está validado.'
        : 'Verifique seu e-mail para liberar áreas sensíveis, descoberta e mais recursos.',

      roleLabel,
      memberSince,
      lastLoginAt,

      localeLabel: 'Português (Brasil)',
      localeCode: 'pt-BR',

      locationLabel,
      locationDetails,

      googleLinked,
      passwordConfigured,

      twoFactorEnabled: false,
      twoFactorHint:
        'A autenticação em duas etapas ainda não está disponível nesta versão.',

      subscriptionLabel: subscriptionActive
        ? 'Assinatura ativa'
        : billingSnapshot
          ? 'Sem assinatura ativa'
          : 'Não foi possível confirmar agora',
      subscriptionActive,
      activePlanLabel,

      tokensBalance: null,
      quickPurchaseEnabled: null,

      canManageDevices: false,
      devicesRoute: '/conta',

      canBlockAccount: true,
      canDeleteAccount: true,
    };
  }

  private resolveAuthoritativePlanKey(
    snapshot: BillingSnapshotResult | null
  ): PaidPlanKey | null {
    const candidate = String(snapshot?.role ?? snapshot?.tier ?? '')
      .trim()
      .toLowerCase();

    return candidate === 'basic' ||
      candidate === 'premium' ||
      candidate === 'vip'
      ? candidate
      : null;
  }

  private mapRoleLabel(
    user: IUserDados | null,
    paidPlan: PaidPlanKey | null
  ): string {
    if (paidPlan) return this.mapPaidPlanLabel(paidPlan);

    const rawRole = String(user?.role ?? '').trim().toLowerCase();
    switch (rawRole) {
      case 'free':
        return 'Gratuito';
      case 'visitante':
        return 'Visitante';
      case 'basic':
        return 'Básico';
      default:
        return 'Não definido';
    }
  }

  private mapPaidPlanLabel(plan: PaidPlanKey): string {
    switch (plan) {
      case 'vip':
        return 'VIP';
      case 'premium':
        return 'Premium';
      case 'basic':
      default:
        return 'Básico';
    }
  }

  private reportSilent(error: unknown, operation: string): void {
    try {
      const normalized =
        error instanceof Error
          ? error
          : new Error('[AccountFacade] operação falhou');
      const contextual = normalized as Error & {
        original?: unknown;
        context?: unknown;
        skipUserNotification?: boolean;
      };
      contextual.original = error;
      contextual.context = { scope: 'AccountFacade', operation };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // Falha de diagnóstico não interrompe o estado fail-closed da conta.
    }
  }
}

// Operador local pequeno para manter a composição Observable-first sem subscribe.
import { switchMap } from 'rxjs/operators';
function switchMapUid<T>(
  project: (
    uid: string | null,
    repository: BillingRepository
  ) => Observable<T>,
  repository: BillingRepository
) {
  return switchMap((uid: string | null) => project(uid, repository));
}
