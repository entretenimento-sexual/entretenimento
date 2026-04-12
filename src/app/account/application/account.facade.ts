//src\app\account\application\account.facade.ts
// Não esquecer comentários explicativos e ferramentas de debug
import { Injectable, inject } from '@angular/core';
import { combineLatest, Observable } from 'rxjs';
import { map, shareReplay, startWith } from 'rxjs/operators';

import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

import { AccountOverviewVm } from '../models/account-overview.model';

type PaidPlanKey = 'basic' | 'premium' | 'vip';

@Injectable({ providedIn: 'root' })
export class AccountFacade {
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly authSession = inject(AuthSessionService);

  readonly vm$: Observable<AccountOverviewVm | null> = combineLatest([
    this.currentUserStore.user$.pipe(
      map((user): IUserDados | null => user ?? null),
      startWith(null)
    ),
    this.authSession.authUser$.pipe(
      map((authUser) => authUser ?? null),
      startWith(null)
    ),
  ]).pipe(
    map(([user, authUser]) => {
      if (!user && !authUser) return null;
      return this.buildVm(user, authUser);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private buildVm(user: IUserDados | null, authUser: any | null): AccountOverviewVm {
    const nickname = (user?.nickname ?? '').trim() || null;
    const uid = (user?.uid ?? authUser?.uid ?? '').trim() || null;
    const email = user?.email ?? authUser?.email ?? null;
    const emailVerified =
      user?.emailVerified === true || authUser?.emailVerified === true;

    const providerIds = (authUser?.providerData ?? [])
      .map((p: any) => String(p?.providerId ?? '').trim())
      .filter(Boolean);

    const googleLinked = providerIds.includes('google.com');

    const memberSince =
      user?.registrationDate ??
      user?.createdAt ??
      user?.firstLogin ??
      null;

    const lastLoginAt = user?.lastLogin ?? null;

    const estado = (user?.estado ?? '').trim();
    const municipio = (user?.municipio ?? '').trim();

    const locationLabel =
      municipio && estado
        ? `${municipio}`
        : estado || 'Não informado';

    const locationDetails =
      municipio && estado
        ? `${municipio}, ${estado}, BR`
        : estado
          ? `${estado}, BR`
          : 'Localização não informada';

    const effectivePlanKey = this.resolvePaidPlanKey(user);
    const subscriptionActive = this.isSubscriptionActive(user, effectivePlanKey);
    const roleLabel = this.mapRoleLabel(user, effectivePlanKey);
    const activePlanLabel = subscriptionActive ? roleLabel : null;

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
      passwordConfigured: true,

      twoFactorEnabled: false,
      twoFactorHint:
        email
          ? `Toda vez que acessar em um novo dispositivo pela primeira vez, podemos enviar um código para ${email}.`
          : 'Associe um e-mail válido para reforçar a segurança em novos dispositivos.',

      subscriptionLabel: this.mapSubscriptionLabel(subscriptionActive),
      subscriptionActive,
      activePlanLabel,

      tokensBalance: null,

      quickPurchaseEnabled: null,

      canManageDevices: true,
      devicesRoute: '/conta#dispositivos',

      canBlockAccount: true,
      canDeleteAccount: true,
    };
  }

  private resolvePaidPlanKey(user: IUserDados | null): PaidPlanKey | null {
    if (!user) return null;

    const role = String(user.role ?? '').trim().toLowerCase();
    const tier = String((user as any).tier ?? '').trim().toLowerCase();
    const candidate = role || tier;

    if (candidate === 'basic' || candidate === 'premium' || candidate === 'vip') {
      return candidate;
    }

    return null;
  }

  /**
   * REGRA CORRIGIDA:
   * - assinatura ativa NÃO deve nascer só porque role/tier é basic/premium/vip
   * - assinatura ativa depende de:
   *   1) isSubscriber === true
   *   2) subscriptionStatus === 'active'
   */
  private isSubscriptionActive(
    user: IUserDados | null,
    _effectivePlanKey: PaidPlanKey | null
  ): boolean {
    if (!user) return false;

    const subscriptionStatus = String((user as any).subscriptionStatus ?? '')
      .trim()
      .toLowerCase();

    return (
      user.isSubscriber === true ||
      subscriptionStatus === 'active'
    );
  }

  private mapRoleLabel(
    user: IUserDados | null,
    effectivePlanKey: PaidPlanKey | null
  ): string {
    const rawRole = String(user?.role ?? '').trim().toLowerCase();
    const rawTier = String((user as any)?.tier ?? '').trim().toLowerCase();
    const fallbackPlan = rawRole || rawTier;
    const normalized = effectivePlanKey ?? fallbackPlan;

    switch (normalized) {
      case 'vip':
        return 'VIP';
      case 'premium':
        return 'Premium';
      case 'basic':
        return 'Básico';
      case 'free':
        return 'Gratuito';
      case 'visitante':
        return 'Visitante';
      default:
        return 'Não definido';
    }
  }

  private mapSubscriptionLabel(subscriptionActive: boolean): string {
    return subscriptionActive
      ? 'Assinatura ativa'
      : 'Sem assinatura ativa';
  }
}