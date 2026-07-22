// src/app/subscriptions/subscription-plan/subscription-plan.component.ts
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { combineLatest } from 'rxjs';
import { distinctUntilChanged, map, shareReplay, tap } from 'rxjs/operators';

import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { PlatformSubscriptionAccessService } from '@core/services/subscriptions/platform-subscription-access.service';
import type { PlatformSubscriptionAccessState } from '@core/services/subscriptions/platform-subscription-access.model';
import { IncompleteProfileSubscriptionNoticeService } from '../application/incomplete-profile-subscription-notice.service';
import { IUserDados } from '@core/interfaces/iuser-dados';

type PaidPlanKey = 'basic' | 'premium' | 'vip';

interface SubscriptionPlanCardVm {
  key: PaidPlanKey;
  badge: string;
  title: string;
  priceLabel: string;
  description: string;
  features: string[];
  featured?: boolean;
}

interface SubscriptionPlanPageVm {
  uid: string | null;
  subscriptionActive: boolean;
  currentPlanKey: PaidPlanKey | null;
  currentPlanLabel: string | null;
  statusTitle: string;
  statusDescription: string;
  canGoToAccount: boolean;
  canGoToProfile: boolean;
}

@Component({
  selector: 'app-subscription-plan',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './subscription-plan.component.html',
  styleUrls: ['./subscription-plan.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SubscriptionPlanComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly subscriptionAccess = inject(
    PlatformSubscriptionAccessService
  );
  private readonly noticeService = inject(
    IncompleteProfileSubscriptionNoticeService
  );

  readonly currentUser$ = this.currentUserStore.user$.pipe(
    map((user) => user ?? null),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly vm$ = combineLatest([
    this.currentUser$,
    this.subscriptionAccess.state$,
  ]).pipe(
    map(([user, access]) => this.buildVm(user, access)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly shouldShowSubscriptionWarning$ = this.noticeService.shouldShow$(
    this.currentUser$,
    this.buildStaticContext$('subscription-plan')
  );

  readonly subscriptionWarningItems = [
    'sua conta premium será ativada normalmente',
    'sua visibilidade pode continuar reduzida',
    'você pode ter limitações para ser encontrado ou iniciar algumas interações',
  ];

  readonly plans: SubscriptionPlanCardVm[] = [
    {
      key: 'basic',
      badge: 'Entrada',
      title: 'Plano Básico',
      priceLabel: 'R$19,99/mês',
      description:
        'Uma entrada sólida para explorar a plataforma com mais liberdade e discrição.',
      features: [
        'Acesso ampliado à plataforma',
        'Melhor base para descoberta e navegação',
        'Entrada ideal para quem quer começar',
      ],
    },
    {
      key: 'premium',
      badge: 'Mais escolhido',
      title: 'Plano Premium',
      priceLabel: 'R$29,99/mês',
      description:
        'Equilíbrio melhor entre recursos, visibilidade e experiência de uso.',
      features: [
        'Todos os benefícios do Básico',
        'Mais destaque de conta',
        'Experiência mais completa na plataforma',
      ],
      featured: true,
    },
    {
      key: 'vip',
      badge: 'Topo',
      title: 'Plano VIP',
      priceLabel: 'R$39,99/mês',
      description:
        'Camada superior para quem quer a experiência mais completa disponível.',
      features: [
        'Todos os benefícios anteriores',
        'Maior prioridade de experiência',
        'Plano mais avançado da plataforma',
      ],
    },
  ];

  ngOnInit(): void {
    this.currentUser$
      .pipe(
        tap((user) => {
          this.noticeService.hydrate(user?.uid);
        })
      )
      .subscribe();
  }

  subscribe(plan: PaidPlanKey, vm: SubscriptionPlanPageVm): void {
    const isCurrentPlan = vm.subscriptionActive && vm.currentPlanKey === plan;

    if (isCurrentPlan) {
      this.goToAccount();
      return;
    }

    this.router.navigate(['/checkout'], {
      queryParams: { plan },
    });
  }

  goToAccount(): void {
    this.router.navigate(['/conta']);
  }

  goToProfile(): void {
    this.router.navigate(['/perfil']);
  }

  getPlanActionLabel(
    plan: PaidPlanKey,
    vm: SubscriptionPlanPageVm
  ): string {
    if (vm.subscriptionActive && vm.currentPlanKey === plan) {
      return 'Plano atual';
    }

    if (!vm.subscriptionActive) {
      return 'Assinar agora';
    }

    const currentRank = this.getPlanRank(vm.currentPlanKey);
    const nextRank = this.getPlanRank(plan);

    if (nextRank > currentRank) return 'Fazer upgrade';
    if (nextRank < currentRank) return 'Mudar para este plano';
    return 'Assinar agora';
  }

  private buildVm(
    user: IUserDados | null,
    access: PlatformSubscriptionAccessState
  ): SubscriptionPlanPageVm {
    const currentPlanKey = access.active ? access.role : null;
    const currentPlanLabel = currentPlanKey
      ? this.getPlanDisplayName(currentPlanKey)
      : null;

    return {
      uid: user?.uid ?? null,
      subscriptionActive: access.active,
      currentPlanKey,
      currentPlanLabel,
      statusTitle:
        access.active && currentPlanLabel
          ? `${currentPlanLabel} ativo`
          : 'Sem assinatura ativa',
      statusDescription:
        access.active && currentPlanLabel
          ? `Seu plano atual reconhecido na plataforma é ${currentPlanLabel}.`
          : 'Você ainda não possui um plano ativo reconhecido na plataforma.',
      canGoToAccount: !!user?.uid,
      canGoToProfile: !!user?.uid,
    };
  }

  private getPlanRank(plan: PaidPlanKey | null): number {
    switch (plan) {
      case 'basic':
        return 1;
      case 'premium':
        return 2;
      case 'vip':
        return 3;
      default:
        return 0;
    }
  }

  private getPlanDisplayName(plan: PaidPlanKey): string {
    switch (plan) {
      case 'basic':
        return 'Plano Básico';
      case 'premium':
        return 'Plano Premium';
      case 'vip':
        return 'Plano VIP';
    }
  }

  private buildStaticContext$(context: 'subscription-plan') {
    return this.currentUser$.pipe(
      map(() => context),
      distinctUntilChanged()
    );
  }
}
