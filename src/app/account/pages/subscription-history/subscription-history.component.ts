// src/app/account/pages/subscription-history/subscription-history.component.ts
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  BehaviorSubject,
  merge,
  of,
  Subject,
} from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  exhaustMap,
  filter,
  map,
  skip,
  switchMap,
} from 'rxjs/operators';

import { BillingRepository } from 'src/app/payments-core/infrastructure/repositories/billing.repository';
import {
  PlatformSubscriptionHistoryItem,
  PlatformSubscriptionHistoryRole,
  PlatformSubscriptionHistorySnapshot,
} from 'src/app/payments-core/domain/models/platform-subscription-history.model';
import { PlatformSubscriptionAccessService } from '@core/services/subscriptions/platform-subscription-access.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';

type SubscriptionHistoryState = {
  status: 'loading' | 'ready' | 'error';
  items: PlatformSubscriptionHistoryItem[];
  nextCursor: string | null;
  loadingMore: boolean;
  loadMoreError: boolean;
  generation: number;
};

const INITIAL_STATE: SubscriptionHistoryState = {
  status: 'loading',
  items: [],
  nextCursor: null,
  loadingMore: false,
  loadMoreError: false,
  generation: 0,
};

@Component({
  selector: 'app-subscription-history',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './subscription-history.component.html',
  styleUrl: './subscription-history.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SubscriptionHistoryComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly repository = inject(BillingRepository);
  private readonly subscriptionAccess = inject(PlatformSubscriptionAccessService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  private readonly reload$ = new Subject<void>();
  private readonly loadMore$ = new Subject<void>();
  private readonly stateSubject = new BehaviorSubject<SubscriptionHistoryState>(
    INITIAL_STATE
  );

  readonly state$ = this.stateSubject.asObservable();

  constructor() {
    const canonicalSubscriptionChanges$ = this.subscriptionAccess.state$.pipe(
      map((state) =>
        [
          state.active,
          state.role,
          state.startsAt,
          state.endsAt,
          state.projectionVersion,
        ].join('|')
      ),
      distinctUntilChanged(),
      skip(1),
      map(() => void 0)
    );

    merge(of(void 0), this.reload$, canonicalSubscriptionChanges$)
      .pipe(
        map(() => {
          const generation = this.stateSubject.value.generation + 1;
          this.stateSubject.next({
            ...INITIAL_STATE,
            status: 'loading',
            generation,
          });
          return generation;
        }),
        switchMap((generation) =>
          this.repository.getMyPlatformSubscriptionHistory$(null, 25).pipe(
            map((page) => ({ ok: true as const, page, generation })),
            catchError((error: unknown) =>
              of({ ok: false as const, error, generation })
            )
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((result) => {
        if (result.generation !== this.stateSubject.value.generation) {
          return;
        }

        if (!result.ok) {
          this.reportError(
            result.error,
            'Não foi possível carregar o histórico da assinatura.',
            'loadHistory',
            false
          );
          this.stateSubject.next({
            ...INITIAL_STATE,
            status: 'error',
            generation: result.generation,
          });
          return;
        }

        this.stateSubject.next({
          status: 'ready',
          items: result.page.items,
          nextCursor: result.page.nextCursor,
          loadingMore: false,
          loadMoreError: false,
          generation: result.generation,
        });
      });

    this.loadMore$
      .pipe(
        map(() => this.stateSubject.value),
        filter(
          (state) =>
            state.status === 'ready'
            && !!state.nextCursor
            && !state.loadingMore
        ),
        map((state) => {
          this.stateSubject.next({
            ...state,
            loadingMore: true,
            loadMoreError: false,
          });
          return state;
        }),
        exhaustMap((state) =>
          this.repository
            .getMyPlatformSubscriptionHistory$(state.nextCursor, 25)
            .pipe(
              map((page) => ({ ok: true as const, state, page })),
              catchError((error: unknown) =>
                of({ ok: false as const, state, error })
              )
            )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((result) => {
        const current = this.stateSubject.value;
        if (result.state.generation !== current.generation) {
          return;
        }

        if (!result.ok) {
          this.reportError(
            result.error,
            'Não foi possível carregar registros mais antigos.',
            'loadMoreHistory',
            true
          );
          this.stateSubject.next({
            ...current,
            loadingMore: false,
            loadMoreError: true,
          });
          return;
        }

        const mergedItems = new Map<string, PlatformSubscriptionHistoryItem>();
        for (const item of [...current.items, ...result.page.items]) {
          mergedItems.set(item.id, item);
        }

        this.stateSubject.next({
          status: 'ready',
          items: Array.from(mergedItems.values()),
          nextCursor: result.page.nextCursor,
          loadingMore: false,
          loadMoreError: false,
          generation: current.generation,
        });
      });
  }

  retry(): void {
    this.reload$.next();
  }

  loadMore(): void {
    this.loadMore$.next();
  }

  eventTitle(item: PlatformSubscriptionHistoryItem): string {
    switch (item.eventType) {
      case 'subscription_started':
        return 'Assinatura iniciada';
      case 'subscription_renewed':
        return 'Assinatura renovada';
      case 'subscription_upgraded':
        return 'Upgrade de plano';
      case 'subscription_downgraded':
        return 'Mudança de plano';
      case 'subscription_expired':
        return 'Assinatura expirada';
      case 'subscription_deactivated':
        return 'Assinatura encerrada';
      case 'subscription_repaired':
        return 'Assinatura sincronizada';
    }
  }

  eventDescription(item: PlatformSubscriptionHistoryItem): string {
    const from = this.snapshotRoleLabel(item.from);
    const to = this.snapshotRoleLabel(item.to);

    switch (item.eventType) {
      case 'subscription_started':
        return `${to} passou a ser o plano ativo da conta.`;
      case 'subscription_renewed':
        return `O período do ${to} foi renovado.`;
      case 'subscription_upgraded':
        return `O plano mudou de ${from} para ${to}.`;
      case 'subscription_downgraded':
        return `O plano mudou de ${from} para ${to}.`;
      case 'subscription_expired':
        return `O período do ${from} terminou e a conta voltou ao plano Gratuito.`;
      case 'subscription_deactivated':
        return `O ${from} deixou de estar ativo e a conta voltou ao plano Gratuito.`;
      case 'subscription_repaired':
        return 'A plataforma reconciliou os dados da assinatura para manter o estado da conta consistente.';
    }
  }

  sourceLabel(item: PlatformSubscriptionHistoryItem): string {
    switch (item.source) {
      case 'payment_settlement':
        return 'Pagamento confirmado';
      case 'subscription_reconciliation':
        return 'Atualização automática de vigência';
      case 'system_repair':
        return 'Sincronização automática';
      case 'entitlement_deleted':
        return 'Encerramento do benefício';
      case 'entitlement_change':
        return 'Atualização do benefício';
    }
  }

  snapshotRoleLabel(
    snapshot: PlatformSubscriptionHistorySnapshot | null
  ): string {
    return this.roleLabel(snapshot?.role ?? 'free');
  }

  roleLabel(role: PlatformSubscriptionHistoryRole): string {
    switch (role) {
      case 'basic':
        return 'Plano Básico';
      case 'premium':
        return 'Plano Premium';
      case 'vip':
        return 'Plano VIP';
      case 'free':
        return 'Plano Gratuito';
    }
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
        // O diagnóstico técnico abaixo permanece ativo.
      }
    }

    try {
      const normalized = error instanceof Error ? error : new Error(String(error));
      const contextual = normalized as Error & {
        context?: unknown;
        skipUserNotification?: boolean;
      };
      contextual.context = {
        feature: 'subscription-history',
        operation,
        scope: 'SubscriptionHistoryComponent',
        op: operation,
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // Falha secundária não interrompe o estado visual da página.
    }
  }
}
