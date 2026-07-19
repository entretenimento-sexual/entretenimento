// src/app/account/application/account-lifecycle.facade.ts
// -----------------------------------------------------------------------------
// ACCOUNT LIFECYCLE FACADE
// -----------------------------------------------------------------------------
// - Deriva o estado canônico da conta a partir do CurrentUserStore.
// - Atualiza permissões temporais, como cancelamento de exclusão, sem reload.
// - Não executa comandos, navegação ou subscribe interno.
// -----------------------------------------------------------------------------
import { Injectable, inject } from '@angular/core';
import { combineLatest, Observable, timer } from 'rxjs';
import {
  distinctUntilChanged,
  map,
  shareReplay,
} from 'rxjs/operators';

import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { IUserDados } from '@core/interfaces/iuser-dados';

import {
  AccountLifecycleState,
  AccountStatusVm,
  DEFAULT_ACCOUNT_LIFECYCLE_STATE,
} from '../models/account-lifecycle.model';

@Injectable({ providedIn: 'root' })
export class AccountLifecycleFacade {
  private readonly currentUserStore = inject(CurrentUserStoreService);

  readonly currentUser$ = this.currentUserStore.user$.pipe(
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly lifecycleState$: Observable<AccountLifecycleState> =
    this.currentUser$.pipe(
      map((user) => this.mapUserToLifecycleState(user)),
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  /** Atualiza prazos visuais a cada 30 segundos sem polling de rede. */
  private readonly clock$ = timer(0, 30_000).pipe(
    map(() => Date.now()),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly statusVm$: Observable<AccountStatusVm> = combineLatest([
    this.lifecycleState$,
    this.clock$,
  ]).pipe(
    map(([state, now]) => this.mapLifecycleStateToVm(state, now)),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly isLifecycleBlocked$: Observable<boolean> =
    this.lifecycleState$.pipe(
      map((state) => state.accountStatus !== 'active'),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly canUseRegularAccountFlow$: Observable<boolean> =
    this.lifecycleState$.pipe(
      map((state) => state.accountStatus === 'active'),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly shouldUseStatusPage$: Observable<boolean> =
    this.lifecycleState$.pipe(
      map((state) => this.isBlockedStatus(state.accountStatus)),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly isSelfSuspended$: Observable<boolean> =
    this.lifecycleState$.pipe(
      map((state) => state.accountStatus === 'self_suspended'),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly isModerationSuspended$: Observable<boolean> =
    this.lifecycleState$.pipe(
      map((state) => state.accountStatus === 'moderation_suspended'),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly isPendingDeletion$: Observable<boolean> =
    this.lifecycleState$.pipe(
      map((state) => state.accountStatus === 'pending_deletion'),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly isDeleted$: Observable<boolean> = this.lifecycleState$.pipe(
    map((state) => state.accountStatus === 'deleted'),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private mapUserToLifecycleState(
    user: IUserDados | null | undefined
  ): AccountLifecycleState {
    if (!user) return DEFAULT_ACCOUNT_LIFECYCLE_STATE;

    const accountStatus = this.normalizeAccountStatus(user);
    const blocked = this.isBlockedStatus(accountStatus);

    return {
      accountStatus,
      publicVisibility:
        (user.publicVisibility ?? (blocked ? 'hidden' : 'visible')) ===
        'hidden'
          ? 'hidden'
          : 'visible',
      interactionBlocked: user.interactionBlocked ?? blocked,
      loginAllowed:
        user.loginAllowed ?? this.defaultLoginAllowed(accountStatus),
      statusUpdatedAt: this.normalizeEpoch(user.statusUpdatedAt),
      statusUpdatedBy: user.statusUpdatedBy ?? null,
      suspensionReason: user.suspensionReason ?? null,
      suspensionSource: user.suspensionSource ?? null,
      suspensionEndsAt: this.normalizeEpoch(user.suspensionEndsAt),
      deletionRequestedAt: this.normalizeEpoch(user.deletionRequestedAt),
      deletionRequestedBy: user.deletionRequestedBy ?? null,
      deletionUndoUntil: this.normalizeEpoch(user.deletionUndoUntil),
      purgeAfter: this.normalizeEpoch(user.purgeAfter),
      deletedAt: this.normalizeEpoch(user.deletedAt),
    };
  }

  private mapLifecycleStateToVm(
    state: AccountLifecycleState,
    now: number
  ): AccountStatusVm {
    switch (state.accountStatus) {
      case 'self_suspended':
        return {
          title: 'Sua conta está suspensa por você',
          description:
            'Seu perfil está invisível e as interações permanecem bloqueadas até a reativação.',
          badgeLabel: 'Suspensão voluntária',
          isBlocked: true,
          canReactivateSelfSuspension: true,
          canCancelDeletion: false,
          canGoToAccountHome: false,
          suspensionReason: state.suspensionReason,
          suspensionEndsAt: state.suspensionEndsAt,
          deletionUndoUntil: null,
          purgeAfter: null,
        };

      case 'moderation_suspended':
        return {
          title: 'Sua conta está suspensa pela moderação',
          description:
            'Seu perfil está oculto e as interações permanecem bloqueadas. Esta suspensão não pode ser removida pelo fluxo de autossuspensão.',
          badgeLabel: 'Suspensão por moderação',
          isBlocked: true,
          canReactivateSelfSuspension: false,
          canCancelDeletion: false,
          canGoToAccountHome: false,
          suspensionReason: state.suspensionReason,
          suspensionEndsAt: state.suspensionEndsAt,
          deletionUndoUntil: null,
          purgeAfter: null,
        };

      case 'pending_deletion': {
        const undoOpen =
          state.deletionRequestedBy === 'self' &&
          state.deletionUndoUntil !== null &&
          state.deletionUndoUntil > now;

        return {
          title: 'Sua conta está em processo de exclusão',
          description: undoOpen
            ? 'Seu perfil já foi ocultado. Você ainda pode cancelar a solicitação dentro do prazo indicado.'
            : 'Seu perfil está oculto e o prazo de cancelamento terminou. A exclusão definitiva poderá ser processada conforme a política de retenção.',
          badgeLabel: undoOpen
            ? 'Exclusão pendente'
            : 'Cancelamento encerrado',
          isBlocked: true,
          canReactivateSelfSuspension: false,
          canCancelDeletion: undoOpen,
          canGoToAccountHome: false,
          suspensionReason: null,
          suspensionEndsAt: null,
          deletionUndoUntil: state.deletionUndoUntil,
          purgeAfter: state.purgeAfter,
        };
      }

      case 'deleted':
        return {
          title: 'Esta conta foi excluída',
          description:
            'A conta não está mais disponível para uso normal na plataforma.',
          badgeLabel: 'Conta excluída',
          isBlocked: true,
          canReactivateSelfSuspension: false,
          canCancelDeletion: false,
          canGoToAccountHome: false,
          suspensionReason: null,
          suspensionEndsAt: null,
          deletionUndoUntil: null,
          purgeAfter: state.purgeAfter,
        };

      case 'active':
      default:
        return {
          title: 'Sua conta está ativa',
          description:
            'Sua conta está disponível normalmente para navegação e uso da plataforma.',
          badgeLabel: 'Conta ativa',
          isBlocked: false,
          canReactivateSelfSuspension: false,
          canCancelDeletion: false,
          canGoToAccountHome: true,
          suspensionReason: null,
          suspensionEndsAt: null,
          deletionUndoUntil: null,
          purgeAfter: null,
        };
    }
  }

  private normalizeAccountStatus(
    user: IUserDados
  ): AccountLifecycleState['accountStatus'] {
    const rawStatus = String(user.accountStatus ?? '')
      .trim()
      .toLowerCase();

    if (
      rawStatus === 'active' ||
      rawStatus === 'self_suspended' ||
      rawStatus === 'moderation_suspended' ||
      rawStatus === 'pending_deletion' ||
      rawStatus === 'deleted'
    ) {
      return rawStatus;
    }

    if (user.suspended === true) {
      return user.suspensionSource === 'self'
        ? 'self_suspended'
        : 'moderation_suspended';
    }

    return 'active';
  }

  private normalizeEpoch(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0
      ? Math.trunc(parsed)
      : null;
  }

  private isBlockedStatus(
    status: AccountLifecycleState['accountStatus']
  ): boolean {
    return status !== 'active';
  }

  private defaultLoginAllowed(
    status: AccountLifecycleState['accountStatus']
  ): boolean {
    return status !== 'deleted';
  }
}
