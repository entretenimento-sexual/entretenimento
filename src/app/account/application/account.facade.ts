// src/app/account/application/account.facade.ts
// -----------------------------------------------------------------------------
// ACCOUNT FACADE
// -----------------------------------------------------------------------------
// - Combina Auth, perfil runtime e a assinatura canônica do Angular.
// - Não concede visualmente assinatura a partir de role/tier projetados.
// - Não anuncia senha, 2FA ou gestão de dispositivos sem evidência real.
//
// Supressão explícita preservada:
// - `BillingRepository.getMyBillingSnapshot$()` não é uma segunda stream visual.
//
// Motivo:
// - o snapshot financeiro continua sendo reconciliado pelo backend;
// - `PlatformSubscriptionAccessService` é a projeção canônica, reativa e
//   compartilhada no Angular.
// -----------------------------------------------------------------------------
import { Injectable, inject } from '@angular/core';
import { User } from 'firebase/auth';
import { combineLatest, Observable } from 'rxjs';
import {
  distinctUntilChanged,
  map,
  shareReplay,
  startWith,
} from 'rxjs/operators';

import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { PlatformSubscriptionAccessService } from 'src/app/core/services/subscriptions/platform-subscription-access.service';
import type {
  PlatformSubscriptionAccessState,
  PlatformSubscriptionRole,
} from 'src/app/core/services/subscriptions/platform-subscription-access.model';

import { AccountOverviewVm } from '../models/account-overview.model';

type PaidPlanKey = PlatformSubscriptionRole;

@Injectable({ providedIn: 'root' })
export class AccountFacade {
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly authSession = inject(AuthSessionService);
  private readonly subscriptionAccess = inject(PlatformSubscriptionAccessService);

  readonly vm$: Observable<AccountOverviewVm | null> = combineLatest([
    this.currentUserStore.user$.pipe(
      map((user): IUserDados | null => user ?? null),
      startWith(null)
    ),
    this.authSession.authUser$.pipe(
      map((authUser): User | null => authUser ?? null),
      startWith(null)
    ),
    this.subscriptionAccess.state$,
  ]).pipe(
    map(([user, authUser, subscriptionState]) => {
      if (!user && !authUser) return null;
      return this.buildVm(user, authUser, subscriptionState);
    }),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private buildVm(
    user: IUserDados | null,
    authUser: User | null,
    subscriptionState: PlatformSubscriptionAccessState
  ): AccountOverviewVm {
    const nickname = String(user?.nickname ?? '').trim() || null;
    const uid = String(user?.uid ?? authUser?.uid ?? '').trim() || null;
    const email = user?.email ?? authUser?.email ?? null;
    const emailVerified =
      user?.emailVerified === true || authUser?.emailVerified === true;

    const providerIds = (authUser?.providerData ?? [])
      .map((provider) => String(provider?.providerId ?? '').trim())
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

    const effectivePlanKey =
      subscriptionState.active ? subscriptionState.role : null;
    const subscriptionActive =
      subscriptionState.active && effectivePlanKey !== null;
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
        : 'Sem assinatura ativa',
      subscriptionActive,
      activePlanLabel,
      subscriptionStartedAt: subscriptionActive
        ? subscriptionState.startsAt
        : null,
      subscriptionEndsAt: subscriptionActive
        ? subscriptionState.endsAt
        : null,

      tokensBalance: null,
      quickPurchaseEnabled: null,

      canManageDevices: false,
      devicesRoute: '/conta',

      canBlockAccount: true,
      canDeleteAccount: true,
    };
  }

  private mapRoleLabel(
    user: IUserDados | null,
    paidPlan: PaidPlanKey | null
  ): string {
    if (user?.role === 'admin') return 'Administrador';
    if (paidPlan) return this.mapPaidPlanLabel(paidPlan);
    if (user?.role === 'visitante') return 'Visitante';
    return 'Gratuito';
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
}
