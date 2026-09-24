// src/app/subscriptions/subscription-plan/subscription-plan.component.ts
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { combineLatest, EMPTY, of, Subject } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  finalize,
  map,
  shareReplay,
  startWith,
  switchMap,
  tap,
} from 'rxjs/operators';

import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { PlatformSubscriptionAccessService } from '@core/services/subscriptions/platform-subscription-access.service';
import type { PlatformSubscriptionAccessState } from '@core/services/subscriptions/platform-subscription-access.model';
import { IncompleteProfileSubscriptionNoticeService } from '../application/incomplete-profile-subscription-notice.service';
import { IUserDados } from '@core/interfaces/iuser-dados';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { BillingRepository } from 'src/app/payments-core/infrastructure/repositories/billing.repository';
import type { BillingPlan } from 'src/app/payments-core/domain/models/billing-plan.model';
import type {
  BillingSnapshotResult,
} from 'src/app/payments-core/domain/models/billing-return.model';
import {
  ConfirmationDialogComponent,
} from 'src/app/shared/components-globais/confirmation-dialog/confirmation-dialog.component';
import {
  isCommunityCreationSubscriptionFlow,
  normalizeSubscriptionFlowContext,
  SubscriptionFlowContext,
  subscriptionFlowQueryParams,
} from '../domain/subscription-flow-context.model';

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
  flowContext: SubscriptionFlowContext;
  communityCreationFlow: boolean;
  subscriptionEndsAt: number | null;
  downgradeSchedulingAvailable: boolean;
  scheduledPlanChange: {
    planKey: PaidPlanKey;
    effectiveAt: number;
    providerUpdateStatus: 'applied' | 'pending';
  } | null;
}

/**
 * Copy de apresentação apenas. Os limites numéricos e a quantidade de
 * Comunidades que cada plano pode criar pertencem à capability retornada pelo
 * backend e não são duplicados nesta tela.
 */
function communityPlanFeatures(plan: PaidPlanKey): string[] {
  switch (plan) {
    case 'basic':
      return [
        'Criação e administração de Comunidade pessoal',
        'Capacidade inicial para desenvolver sua Comunidade',
      ];
    case 'premium':
      return [
        'Mais espaço para criar e administrar Comunidades pessoais',
        'Capacidade ampliada para crescimento das Comunidades',
      ];
    case 'vip':
      return [
        'Maior liberdade para administrar Comunidades pessoais',
        'Maior capacidade disponível para crescimento das Comunidades',
      ];
  }
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
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly subscriptionAccess = inject(
    PlatformSubscriptionAccessService
  );
  private readonly noticeService = inject(
    IncompleteProfileSubscriptionNoticeService
  );
  private readonly billingRepository = inject(BillingRepository);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly dialog = inject(MatDialog);
  private readonly refreshBilling$ = new Subject<void>();

  readonly schedulingDowngrade = signal(false);

  readonly currentUser$ = this.currentUserStore.user$.pipe(
    map((user) => user ?? null),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
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

  readonly billingState$ = this.refreshBilling$.pipe(
    startWith(void 0),
    switchMap(() =>
      this.billingRepository.getMyBillingSnapshot$().pipe(
        catchError((error: unknown) => {
          this.applicationError.report(error, {
            feature: 'subscription-plan',
            operation: 'loadBillingSnapshot',
            fallbackMessage:
              'Não foi possível carregar as opções de mudança de plano.',
            presentation: { surface: 'none', severity: 'error' },
            metadata: { scope: 'SubscriptionPlanComponent' },
          });
          return of(null);
        })
      )
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly vm$ = combineLatest([
    this.currentUser$,
    this.subscriptionAccess.state$,
    this.flowContext$,
    this.billingState$,
  ]).pipe(
    map(([user, access, flowContext, billing]) =>
      this.buildVm(user, access, flowContext, billing)
    ),
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

  readonly plans$ = this.billingRepository.getPlatformPlans$().pipe(
    map((catalog) =>
      catalog.plans
        .filter((plan) => plan.active)
        .map((plan) => this.toPlanCard(plan))
    ),
    catchError((error: unknown) => {
      this.applicationError.report(error, {
        feature: 'subscription-plan',
        operation: 'loadCanonicalPlans',
        fallbackMessage: 'Não foi possível carregar os planos disponíveis.',
        presentation: { surface: 'snackbar', severity: 'error' },
        metadata: { scope: 'SubscriptionPlanComponent' },
      });
      return of([] as SubscriptionPlanCardVm[]);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  ngOnInit(): void {
    this.currentUser$
      .pipe(
        tap((user) => {
          this.noticeService.hydrate(user?.uid);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  subscribe(plan: PaidPlanKey, vm: SubscriptionPlanPageVm): void {
    const isCurrentPlan = vm.subscriptionActive && vm.currentPlanKey === plan;

    if (isCurrentPlan) {
      this.goToAccount();
      return;
    }

    if (!this.canSelectPlan(plan, vm)) {
      return;
    }

    if (this.isDowngrade(plan, vm)) {
      this.scheduleDowngrade(plan, vm);
      return;
    }

    this.router.navigate(['/checkout'], {
      queryParams: {
        plan,
        ...subscriptionFlowQueryParams(vm.flowContext),
      },
    });
  }

  private scheduleDowngrade(
    planKey: PaidPlanKey,
    vm: SubscriptionPlanPageVm
  ): void {
    if (this.schedulingDowngrade()) return;

    const effectiveDate = vm.subscriptionEndsAt
      ? new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'long',
      }).format(new Date(vm.subscriptionEndsAt))
      : 'o fim do ciclo atual';

    this.dialog
      .open(ConfirmationDialogComponent, {
        data: {
          title: 'Agendar redução de plano',
          eyebrow: 'Assinatura',
          message:
            `Seu plano atual continuará sem alteração até ${effectiveDate}.`,
          detail:
            'Depois disso, as próximas cobranças e o acesso passarão para o plano selecionado. Não haverá estorno nem redução antecipada do período já pago.',
          confirmLabel: 'Agendar redução',
          cancelLabel: 'Manter plano atual',
          tone: 'warning',
          icon: 'event_repeat',
        },
        autoFocus: false,
        restoreFocus: true,
      })
      .afterClosed()
      .pipe(
        filter((confirmed): confirmed is true => confirmed === true),
        tap(() => this.schedulingDowngrade.set(true)),
        switchMap(() =>
          this.billingRepository.getPlatformPlanByKey$(planKey)
        ),
        switchMap((plan) =>
          plan
            ? this.billingRepository
              .schedulePlatformSubscriptionDowngrade$(plan)
            : EMPTY
        ),
        tap(() => this.refreshBilling$.next()),
        catchError((error: unknown) => {
          this.applicationError.report(error, {
            feature: 'subscription-plan',
            operation: 'scheduleDowngrade',
            fallbackMessage:
              'Não foi possível agendar a redução de plano agora.',
            presentation: { surface: 'modal', severity: 'error' },
            metadata: { scope: 'SubscriptionPlanComponent' },
          });
          return EMPTY;
        }),
        finalize(() => this.schedulingDowngrade.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  isRecommendedPlan(
    plan: PaidPlanKey,
    vm: SubscriptionPlanPageVm
  ): boolean {
    return vm.flowContext.minimumRole === plan;
  }

  planMeetsMinimum(
    plan: PaidPlanKey,
    vm: SubscriptionPlanPageVm
  ): boolean {
    const minimumRole = vm.flowContext.minimumRole;
    return minimumRole === null
      || this.getPlanRank(plan) >= this.getPlanRank(minimumRole);
  }

  isDowngrade(plan: PaidPlanKey, vm: SubscriptionPlanPageVm): boolean {
    return vm.subscriptionActive
      && vm.currentPlanKey !== null
      && this.getPlanRank(plan) < this.getPlanRank(vm.currentPlanKey);
  }

  canSelectPlan(plan: PaidPlanKey, vm: SubscriptionPlanPageVm): boolean {
    if (!this.planMeetsMinimum(plan, vm)) return false;
    if (vm.subscriptionActive && vm.currentPlanKey === plan) return false;

    if (this.isDowngrade(plan, vm)) {
      return vm.downgradeSchedulingAvailable
        && vm.scheduledPlanChange === null
        && !this.schedulingDowngrade();
    }

    return true;
  }

  minimumPlanLabel(vm: SubscriptionPlanPageVm): string | null {
    return vm.flowContext.minimumRole
      ? this.getPlanDisplayName(vm.flowContext.minimumRole)
      : null;
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
    if (!this.planMeetsMinimum(plan, vm)) {
      return vm.communityCreationFlow
        ? 'Não atende a esta criação'
        : 'Não atende ao acesso solicitado';
    }

    if (vm.subscriptionActive && vm.currentPlanKey === plan) {
      return 'Plano atual';
    }

    if (this.isDowngrade(plan, vm)) {
      if (vm.scheduledPlanChange?.planKey === plan) {
        return 'Redução agendada';
      }

      if (vm.scheduledPlanChange) {
        return 'Outra redução já agendada';
      }

      if (vm.downgradeSchedulingAvailable) {
        return this.schedulingDowngrade()
          ? 'Agendando...'
          : 'Agendar para próximo ciclo';
      }

      return 'Disponível após ciclo atual';
    }

    if (!vm.subscriptionActive) {
      return 'Assinar agora';
    }

    const currentRank = this.getPlanRank(vm.currentPlanKey);
    const nextRank = this.getPlanRank(plan);

    if (nextRank > currentRank) return 'Fazer upgrade';
    return 'Assinar agora';
  }

  private toPlanCard(plan: BillingPlan): SubscriptionPlanCardVm {
    const presentation = this.planPresentation(plan.key);

    return {
      key: plan.key,
      badge: presentation.badge,
      title: plan.title,
      priceLabel: this.formatPlanPrice(plan),
      description: presentation.description,
      features: presentation.features,
      featured: presentation.featured,
    };
  }

  private formatPlanPrice(plan: BillingPlan): string {
    const value = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: plan.currency,
    }).format(plan.amountCents / 100);

    return plan.interval === 'month' ? `${value}/mês` : value;
  }

  private planPresentation(plan: PaidPlanKey): {
    badge: string;
    description: string;
    features: string[];
    featured?: boolean;
  } {
    switch (plan) {
      case 'basic':
        return {
          badge: 'Entrada',
          description:
            'Uma entrada sólida para explorar a plataforma com mais liberdade e discrição.',
          features: [
            ...communityPlanFeatures('basic'),
            'Acesso ampliado à plataforma',
            'Melhor base para descoberta e navegação',
            'Entrada ideal para quem quer começar',
          ],
        };
      case 'premium':
        return {
          badge: 'Mais escolhido',
          description:
            'Equilíbrio melhor entre recursos, visibilidade e experiência de uso.',
          features: [
            ...communityPlanFeatures('premium'),
            'Todos os benefícios do Básico',
            'Mais destaque de conta',
            'Experiência mais completa na plataforma',
          ],
          featured: true,
        };
      case 'vip':
        return {
          badge: 'Topo',
          description:
            'Camada superior para quem quer a experiência mais completa disponível.',
          features: [
            ...communityPlanFeatures('vip'),
            'Todos os benefícios anteriores',
            'Maior prioridade de experiência',
            'Plano mais avançado da plataforma',
          ],
        };
    }
  }

  private buildVm(
    user: IUserDados | null,
    access: PlatformSubscriptionAccessState,
    flowContext: SubscriptionFlowContext,
    billing: BillingSnapshotResult | null
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
      flowContext,
      communityCreationFlow:
        isCommunityCreationSubscriptionFlow(flowContext),
      subscriptionEndsAt: access.endsAt,
      downgradeSchedulingAvailable:
        billing?.downgradeSchedulingAvailable === true,
      scheduledPlanChange:
        billing?.scheduledPlanChange
          ? {
            planKey: billing.scheduledPlanChange.planKey,
            effectiveAt: billing.scheduledPlanChange.effectiveAt,
            providerUpdateStatus:
              billing.scheduledPlanChange.providerUpdateStatus,
          }
          : null,
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
