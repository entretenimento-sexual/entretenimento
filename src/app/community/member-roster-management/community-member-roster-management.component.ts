// src/app/community/member-roster-management/community-member-roster-management.component.ts
import { AsyncPipe, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import {
  catchError,
  combineLatest,
  distinctUntilChanged,
  exhaustMap,
  filter,
  map,
  of,
  scan,
  shareReplay,
  startWith,
  Subject,
  switchMap,
  tap,
} from 'rxjs';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ImageFallbackDirective } from 'src/app/shared/directives/image-fallback.directive';
import {
  CommunityAssignableMemberRole,
  CommunityManagedMemberItem,
  CommunityManagedMemberListStatus,
  CommunityManagedMembersPage,
  CommunityMemberManagementAction,
} from '../data-access/community-member-management.model';
import { CommunityMemberManagementRepository } from '../data-access/community-member-management.repository';

type ManagedMembersStatus = 'loading' | 'ready' | 'empty' | 'error';

interface ManagedMembersState {
  status: ManagedMembersStatus;
  items: readonly CommunityManagedMemberItem[];
  nextCursor: string | null;
  loadingMore: boolean;
  listStatus: CommunityManagedMemberListStatus;
}

interface LoadRequest {
  listStatus: CommunityManagedMemberListStatus;
  cursor: string | null;
  append: boolean;
}

type LoadEvent =
  | { type: 'loading'; request: LoadRequest }
  | { type: 'success'; request: LoadRequest; page: CommunityManagedMembersPage }
  | { type: 'error'; request: LoadRequest };

type MemberActionState =
  | { status: 'idle'; memberId: null; action: null }
  | {
      status: 'loading' | 'error';
      memberId: string;
      action: CommunityMemberManagementAction;
    };

interface MemberCommand {
  item: CommunityManagedMemberItem;
  action: CommunityMemberManagementAction;
  nextRole: CommunityAssignableMemberRole | null;
}

type DestructiveConfirmation = {
  item: CommunityManagedMemberItem;
  action: 'remove' | 'block';
  nextRole: null;
};

type RoleChangeConfirmation = {
  item: CommunityManagedMemberItem;
  action: 'set_role';
  nextRole: CommunityAssignableMemberRole;
};

type ManagementConfirmation = DestructiveConfirmation | RoleChangeConfirmation;

function initialState(
  listStatus: CommunityManagedMemberListStatus
): ManagedMembersState {
  return {
    status: 'loading',
    items: [],
    nextCursor: null,
    loadingMore: false,
    listStatus,
  };
}

function mergeMembers(
  current: readonly CommunityManagedMemberItem[],
  incoming: readonly CommunityManagedMemberItem[]
): readonly CommunityManagedMemberItem[] {
  const merged = new Map<string, CommunityManagedMemberItem>();
  for (const item of current) merged.set(item.memberId, item);
  for (const item of incoming) merged.set(item.memberId, item);
  return [...merged.values()];
}

function reduceState(
  state: ManagedMembersState,
  event: LoadEvent
): ManagedMembersState {
  if (event.type === 'loading') {
    return event.request.append && state.listStatus === event.request.listStatus
      ? { ...state, loadingMore: true }
      : initialState(event.request.listStatus);
  }

  if (event.type === 'error') {
    return event.request.append && state.items.length > 0
      ? { ...state, loadingMore: false }
      : {
          status: 'error',
          items: [],
          nextCursor: null,
          loadingMore: false,
          listStatus: event.request.listStatus,
        };
  }

  const items =
    event.request.append && state.listStatus === event.request.listStatus
      ? mergeMembers(state.items, event.page.items)
      : event.page.items;

  return {
    status: items.length > 0 ? 'ready' : 'empty',
    items,
    nextCursor: event.page.nextCursor,
    loadingMore: false,
    listStatus: event.request.listStatus,
  };
}

@Component({
  selector: 'app-community-member-roster-management',
  standalone: true,
  imports: [AsyncPipe, DatePipe, ImageFallbackDirective],
  templateUrl: './community-member-roster-management.component.html',
  styleUrl: './community-member-roster-management.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityMemberRosterManagementComponent {
  private readonly repository = inject(CommunityMemberManagementRepository);
  private readonly notifications = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly loadRequests$ = new Subject<LoadRequest>();
  private readonly commands$ = new Subject<MemberCommand>();

  readonly communityId = input.required<string>();
  readonly membershipChanged = output<void>();
  readonly selectedStatus = signal<CommunityManagedMemberListStatus>('active');
  readonly confirmation = signal<ManagementConfirmation | null>(null);

  private readonly communityId$ = toObservable(this.communityId).pipe(
    map((communityId) => communityId.trim()),
    filter((communityId) => communityId.length > 0),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly state$ = combineLatest([
    this.communityId$,
    this.loadRequests$.pipe(
      startWith<LoadRequest>({ listStatus: 'active', cursor: null, append: false })
    ),
  ]).pipe(
    switchMap(([communityId, request]) =>
      this.repository
        .getManagedMembersPage$({
          communityId,
          status: request.listStatus,
          cursor: request.cursor,
          limit: 20,
        })
        .pipe(
          map((page): LoadEvent => ({ type: 'success', request, page })),
          startWith<LoadEvent>({ type: 'loading', request }),
          catchError((error: unknown) => {
            this.reportError(
              error,
              'Não foi possível carregar os participantes da Comunidade.',
              'loadManagedMembers'
            );
            return of<LoadEvent>({ type: 'error', request });
          })
        )
    ),
    scan(reduceState, initialState('active')),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly action$ = this.commands$.pipe(
    exhaustMap((command) =>
      this.repository
        .manageMember$(
          this.communityId().trim(),
          command.item.memberId,
          command.action,
          command.nextRole
        )
        .pipe(
          tap(() => {
            this.confirmation.set(null);
            this.notifications.showSuccess(this.successMessage(command));
            this.membershipChanged.emit();
            this.reloadCurrentStatus();
          }),
          map(
            (): MemberActionState => ({
              status: 'idle',
              memberId: null,
              action: null,
            })
          ),
          startWith<MemberActionState>({
            status: 'loading',
            memberId: command.item.memberId,
            action: command.action,
          }),
          catchError((error: unknown) => {
            this.reportError(
              error,
              this.actionErrorMessage(command.action),
              'manageCommunityMember',
              command
            );
            return of<MemberActionState>({
              status: 'error',
              memberId: command.item.memberId,
              action: command.action,
            });
          })
        )
    ),
    startWith<MemberActionState>({ status: 'idle', memberId: null, action: null }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  selectStatus(status: CommunityManagedMemberListStatus): void {
    if (status === this.selectedStatus()) return;
    this.selectedStatus.set(status);
    this.confirmation.set(null);
    this.loadRequests$.next({ listStatus: status, cursor: null, append: false });
  }

  refresh(): void {
    this.confirmation.set(null);
    this.reloadCurrentStatus();
  }

  loadMore(cursor: string | null): void {
    if (!cursor) return;
    this.loadRequests$.next({
      listStatus: this.selectedStatus(),
      cursor,
      append: true,
    });
  }

  roleLabel(role: CommunityManagedMemberItem['role']): string {
    if (role === 'owner') return 'Proprietário';
    if (role === 'admin') return 'Administração';
    if (role === 'moderator') return 'Moderação';
    return 'Membro';
  }

  roleOptions(
    item: CommunityManagedMemberItem
  ): readonly CommunityAssignableMemberRole[] {
    return item.status === 'active'
      ? item.capabilities.assignableRoles
      : [];
  }

  canChangeRole(item: CommunityManagedMemberItem): boolean {
    return this.roleOptions(item).length > 0;
  }

  canRemove(item: CommunityManagedMemberItem): boolean {
    return item.status === 'active' && item.capabilities.canRemove;
  }

  canBlock(item: CommunityManagedMemberItem): boolean {
    return item.status === 'active' && item.capabilities.canBlock;
  }

  canUnblock(item: CommunityManagedMemberItem): boolean {
    return item.status === 'blocked' && item.capabilities.canUnblock;
  }

  roleBeforeBlockLabel(item: CommunityManagedMemberItem): string | null {
    return item.roleBeforeBlock ? this.roleLabel(item.roleBeforeBlock) : null;
  }

  changeRole(item: CommunityManagedMemberItem, event: Event): void {
    const target = event.target;
    const select = target instanceof HTMLSelectElement ? target : null;
    const value = select?.value ?? '';
    const nextRole: CommunityAssignableMemberRole | null =
      value === 'admin' || value === 'moderator' || value === 'member'
        ? value
        : null;

    if (
      !nextRole
      || nextRole === item.role
      || !item.capabilities.assignableRoles.includes(nextRole)
    ) {
      return;
    }

    // O select representa o estado persistido. A opção escolhida só se torna
    // efetiva depois da confirmação e da resposta da callable.
    if (select) select.value = item.role;
    this.confirmation.set({ item, action: 'set_role', nextRole });
  }

  requestDestructiveAction(
    item: CommunityManagedMemberItem,
    action: 'remove' | 'block'
  ): void {
    const allowed = action === 'remove' ? this.canRemove(item) : this.canBlock(item);
    if (!allowed) return;
    this.confirmation.set({ item, action, nextRole: null });
  }

  cancelConfirmation(): void {
    this.confirmation.set(null);
  }

  confirmRoleChange(): void {
    const confirmation = this.confirmation();
    if (!confirmation || confirmation.action !== 'set_role') return;

    if (
      confirmation.nextRole === confirmation.item.role
      || !confirmation.item.capabilities.assignableRoles.includes(
        confirmation.nextRole
      )
    ) {
      this.confirmation.set(null);
      return;
    }

    this.commands$.next({
      item: confirmation.item,
      action: 'set_role',
      nextRole: confirmation.nextRole,
    });
  }

  confirmDestructiveAction(): void {
    const confirmation = this.confirmation();
    if (!confirmation || confirmation.action === 'set_role') return;

    const stillAllowed = confirmation.action === 'remove'
      ? this.canRemove(confirmation.item)
      : this.canBlock(confirmation.item);
    if (!stillAllowed) {
      this.confirmation.set(null);
      return;
    }

    this.commands$.next({
      item: confirmation.item,
      action: confirmation.action,
      nextRole: null,
    });
  }

  unblock(item: CommunityManagedMemberItem): void {
    if (!this.canUnblock(item)) return;
    this.commands$.next({ item, action: 'unblock', nextRole: null });
  }

  confirmationTitle(confirmation: ManagementConfirmation): string {
    if (confirmation.action === 'set_role') {
      return `Alterar papel de ${confirmation.item.label}?`;
    }
    return confirmation.action === 'block'
      ? `Bloquear ${confirmation.item.label}?`
      : `Remover ${confirmation.item.label}?`;
  }

  confirmationDescription(confirmation: ManagementConfirmation): string {
    if (confirmation.action === 'set_role') {
      const nextRoleLabel = this.roleLabel(confirmation.nextRole);
      if (confirmation.nextRole === 'admin') {
        return `${confirmation.item.label} passará a ter poderes administrativos nesta Comunidade.`;
      }
      if (confirmation.item.role === 'admin') {
        return `${confirmation.item.label} deixará a Administração e passará para ${nextRoleLabel}.`;
      }
      return `O papel mudará de ${this.roleLabel(confirmation.item.role)} para ${nextRoleLabel}.`;
    }

    return confirmation.action === 'block'
      ? 'A pessoa perderá o acesso e não poderá entrar novamente até ser desbloqueada.'
      : 'A pessoa sairá da Comunidade, mas poderá solicitar entrada novamente depois.';
  }

  private reloadCurrentStatus(): void {
    this.loadRequests$.next({
      listStatus: this.selectedStatus(),
      cursor: null,
      append: false,
    });
  }

  private successMessage(command: MemberCommand): string {
    if (command.action === 'set_role' && command.nextRole) {
      return `Papel de ${command.item.label} atualizado para ${this.roleLabel(command.nextRole)}.`;
    }
    if (command.action === 'remove') {
      return `${command.item.label} foi removido da Comunidade.`;
    }
    if (command.action === 'block') {
      return `${command.item.label} foi bloqueado na Comunidade.`;
    }
    return `${command.item.label} foi desbloqueado. Uma nova entrada será necessária.`;
  }

  private actionErrorMessage(action: CommunityMemberManagementAction): string {
    if (action === 'set_role') return 'Não foi possível alterar este papel agora.';
    if (action === 'remove') return 'Não foi possível remover este participante agora.';
    if (action === 'block') return 'Não foi possível bloquear este participante agora.';
    return 'Não foi possível desbloquear este participante agora.';
  }

  private reportError(
    error: unknown,
    fallback: string,
    op: string,
    command: MemberCommand | null = null
  ): void {
    const source = (error ?? {}) as { details?: unknown };
    const details = (source.details ?? {}) as Record<string, unknown>;
    const message = details['reason'] === 'recent-authentication-required'
      ? 'Por segurança, saia e entre novamente antes de confirmar esta ação administrativa.'
      : fallback;

    try {
      this.notifications.showError(message);
    } catch {
      // O diagnóstico centralizado abaixo permanece ativo.
    }

    try {
      const normalized = error instanceof Error ? error : new Error(String(error));
      const contextual = normalized as Error & {
        context?: unknown;
        skipUserNotification?: boolean;
      };
      contextual.context = {
        scope: 'CommunityMemberRosterManagementComponent',
        op,
        communityId: this.communityId().trim(),
        listStatus: this.selectedStatus(),
        memberId: command?.item.memberId ?? null,
        action: command?.action ?? null,
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // Falha secundária não interrompe o estado visual.
    }
  }
}
