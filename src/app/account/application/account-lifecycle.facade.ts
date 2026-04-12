// src/app/account/application/account-lifecycle.facade.ts
// -----------------------------------------------------------------------------
// ACCOUNT LIFECYCLE FACADE
//
// Objetivo:
// - Derivar o estado canônico de lifecycle da conta a partir do CurrentUserStore
// - Centralizar leitura reativa do status operacional da conta
// - Preparar a base para:
//   1) página /conta/status
//   2) guards/redirecionamentos
//   3) dialogs e ações futuras
//
// Importante:
// - Esta façade NÃO executa navegação imperativa.
// - Esta façade NÃO chama backend.
// - Esta façade NÃO faz subscribe interno.
// - Ela apenas expõe Observables derivados.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { distinctUntilChanged, map, shareReplay } from 'rxjs/operators';

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

  /**
   * Usuário runtime atual.
   * - undefined: hidratação em andamento
   * - null: não resolvido / sem perfil runtime disponível
   * - IUserDados: perfil carregado
   */
  readonly currentUser$ = this.currentUserStore.user$.pipe(
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * Estado canônico de lifecycle da conta.
   * Sempre devolve um objeto consistente, mesmo quando o usuário ainda não estiver carregado.
   */
  readonly lifecycleState$: Observable<AccountLifecycleState> = this.currentUser$.pipe(
    map((user) => this.mapUserToLifecycleState(user)),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * ViewModel para a tela de status da conta.
   */
  readonly statusVm$: Observable<AccountStatusVm> = this.lifecycleState$.pipe(
    map((state) => this.mapLifecycleStateToVm(state)),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * Verdade simples para saber se a conta está em um estado operacionalmente bloqueado.
   * Ex.: suspensão voluntária, suspensão por moderação, exclusão pendente, deleted.
   */
  readonly isLifecycleBlocked$: Observable<boolean> = this.lifecycleState$.pipe(
    map((state) => state.accountStatus !== 'active'),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * Verdade simples para saber se a UI normal da conta pode ser usada.
   */
  readonly canUseRegularAccountFlow$: Observable<boolean> = this.lifecycleState$.pipe(
    map((state) => state.accountStatus === 'active'),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * Útil para guards/componentes decidirem redirecionamento para /conta/status.
   * - não navega sozinho
   * - apenas sinaliza
   */
  readonly shouldUseStatusPage$: Observable<boolean> = this.lifecycleState$.pipe(
    map((state) => this.isBlockedStatus(state.accountStatus)),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly isSelfSuspended$: Observable<boolean> = this.lifecycleState$.pipe(
    map((state) => state.accountStatus === 'self_suspended'),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly isModerationSuspended$: Observable<boolean> = this.lifecycleState$.pipe(
    map((state) => state.accountStatus === 'moderation_suspended'),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly isPendingDeletion$: Observable<boolean> = this.lifecycleState$.pipe(
    map((state) => state.accountStatus === 'pending_deletion'),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly isDeleted$: Observable<boolean> = this.lifecycleState$.pipe(
    map((state) => state.accountStatus === 'deleted'),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  // ---------------------------------------------------------------------------
  // Mappers
  // ---------------------------------------------------------------------------

  private mapUserToLifecycleState(
    user: IUserDados | null | undefined
  ): AccountLifecycleState {
    if (!user) {
      return DEFAULT_ACCOUNT_LIFECYCLE_STATE;
    }

    const normalizedStatus = this.normalizeAccountStatus(user);
    const isBlocked = this.isBlockedStatus(normalizedStatus);

    return {
      accountStatus: normalizedStatus,

      publicVisibility:
        (user.publicVisibility ?? (isBlocked ? 'hidden' : 'visible')) === 'hidden'
          ? 'hidden'
          : 'visible',

      interactionBlocked: user.interactionBlocked ?? isBlocked,

      /**
       * Seu requisito atual:
       * - suspensão e pending deletion ainda permitem login
       * - o usuário entra para ver o status/prazo e eventualmente agir
       */
      loginAllowed: user.loginAllowed ?? this.defaultLoginAllowed(normalizedStatus),

      statusUpdatedAt: user.statusUpdatedAt ?? null,
      statusUpdatedBy: user.statusUpdatedBy ?? null,

      suspensionReason: user.suspensionReason ?? null,
      suspensionSource: user.suspensionSource ?? null,
      suspensionEndsAt: user.suspensionEndsAt ?? null,

      deletionRequestedAt: user.deletionRequestedAt ?? null,
      deletionRequestedBy: user.deletionRequestedBy ?? null,
      deletionUndoUntil: user.deletionUndoUntil ?? null,
      purgeAfter: user.purgeAfter ?? null,
      deletedAt: user.deletedAt ?? null,
    };
  }

  private mapLifecycleStateToVm(state: AccountLifecycleState): AccountStatusVm {
    switch (state.accountStatus) {
      case 'self_suspended':
        return {
          title: 'Sua conta está suspensa por você',
          description:
            'Seu perfil está invisível para outras pessoas e todas as interações estão bloqueadas até a reativação.',
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
            'Seu perfil está oculto na plataforma e as interações estão temporariamente bloqueadas.',
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

      case 'pending_deletion':
        return {
          title: 'Sua conta está em processo de exclusão',
          description:
            'Seu perfil já foi ocultado. Você ainda pode cancelar a exclusão dentro do prazo disponível.',
          badgeLabel: 'Exclusão pendente',

          isBlocked: true,
          canReactivateSelfSuspension: false,
          canCancelDeletion: true,
          canGoToAccountHome: false,

          suspensionReason: null,
          suspensionEndsAt: null,

          deletionUndoUntil: state.deletionUndoUntil,
          purgeAfter: state.purgeAfter,
        };

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

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private normalizeAccountStatus(user: IUserDados): AccountLifecycleState['accountStatus'] {
    const rawStatus = String(user.accountStatus ?? '').trim().toLowerCase();

    if (
      rawStatus === 'active' ||
      rawStatus === 'self_suspended' ||
      rawStatus === 'moderation_suspended' ||
      rawStatus === 'pending_deletion' ||
      rawStatus === 'deleted'
    ) {
      return rawStatus;
    }

    /**
     * Compatibilidade com a camada legada:
     * - se ainda só existir `suspended === true`
     * - tenta inferir suspensão por moderação ou voluntária
     */
    if (user.suspended === true) {
      if (user.suspensionSource === 'self') return 'self_suspended';
      return 'moderation_suspended';
    }

    return 'active';
  }

  private isBlockedStatus(status: AccountLifecycleState['accountStatus']): boolean {
    return status !== 'active';
  }

  private defaultLoginAllowed(status: AccountLifecycleState['accountStatus']): boolean {
    switch (status) {
      case 'self_suspended':
      case 'moderation_suspended':
      case 'pending_deletion':
        return true;

      case 'deleted':
        return false;

      case 'active':
      default:
        return true;
    }
  }
}