//src\app\account\application\account.facade.ts
import { Injectable, inject } from '@angular/core';
import { combineLatest, Observable, of } from 'rxjs';
import { map, shareReplay, startWith } from 'rxjs/operators';

import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

import { AccountOverviewVm } from '../models/account-overview.model';

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
    const emailVerified = user?.emailVerified === true || authUser?.emailVerified === true;

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

      roleLabel: this.mapRoleLabel(user?.role),
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

      subscriptionLabel: this.mapSubscriptionLabel(user),
      tokensBalance: null,

      quickPurchaseEnabled: null,

      canManageDevices: true,
      devicesRoute: '/conta#dispositivos',

      canBlockAccount: true,
      canDeleteAccount: true,
    };
  }

  private mapRoleLabel(role: IUserDados['role'] | undefined): string {
    switch (role) {
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

  private mapSubscriptionLabel(user: IUserDados | null): string {
    if (!user) return 'Indisponível';

    if (user.isSubscriber) {
      return 'Assinatura ativa';
    }

    return 'Sem assinatura ativa';
  }
}