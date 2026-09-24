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
  debounceTime,
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

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { ImageFallbackDirective } from 'src/app/shared/directives/image-fallback.directive';
import {
  CommunityAssignableMemberRole,
  CommunityManagedMemberItem,
  CommunityManagedMemberListStatus,
  CommunityManagedMemberRoleFilter,
  CommunityManagedMembersPage,
  CommunityMemberManagementAction,
} from '../data-access/community-member-management.model';
import { CommunityMemberManagementRepository } from '../data-access/community-member-management.repository';
import {
  COMMUNITY_MEMBER_MANAGEMENT_CODE_MESSAGES,
  COMMUNITY_MEMBER_MANAGEMENT_REASON_MESSAGES,
} from '../presentation/community-error.messages';

type ManagedMembersStatus = 'loading' | 'ready' | 'empty' | 'error';

interface ManagedMemberFilters {
  readonly listStatus: CommunityManagedMemberListStatus;
  readonly roleFilter: CommunityManagedMemberRoleFilter;
  readonly query: string;
}

interface ManagedMembersState {
  status: ManagedMembersStatus;
  items: readonly CommunityManagedMemberItem[];
  nextCursor: string | null;
  loadingMore: boolean;
}

type ManagedMembersPageEvent =
  | { type: 'loading-more' }
  | { type: 'page'; page: CommunityManagedMembersPage }
  | { type: 'load-more-error' };

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

function normalizeSearchTerm(value: unknown): string {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);

  return normalized.length >= 2 ? normalized : '';
}

function readyState(page: CommunityManagedMembersPage): ManagedMembersState {
  return {
    status: page.items.length > 0 ? 'ready' : 'empty',
    items: page.items,
    nextCursor: page.nextCursor,
    loadingMore: false,
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

function reducePageEvent(
  state: ManagedMembersState,
  event: ManagedMembersPageEvent
): ManagedMembersState {
  if (event.type === 'loading-more') {
    return { ...state, loadingMore: true };
  }

  if (event.type === 'load-more-error') {
    return { ...state, loadingMore: false };
  }

  const items = mergeMembers(state.items, event.page.items);
  return {
    status: items.length > 0 ? 'ready' : 'empty',
    items,
    nextCursor: event.page.nextCursor,
    loadingMore: false,
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
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly refresh$ = new Subject<void>();
  private readonly loadMore$ = new Subject<string>();
  private readonly commands$ = new Subject<MemberCommand>();

  readonly communityId = input.required<string>();
  readonly membershipChanged = output<void>();
  readonly selectedStatus = signal<CommunityManagedMemberListStatus>('active');
  readonly selectedRoleFilter = signal<CommunityManagedMemberRoleFilter>('all');
  readonly searchTerm = signal('');
  readonly confirmation = signal<ManagementConfirmation | null>(null);

  private readonly communityId$ = toObservable(this.communityId).pipe(
    map((communityId) => communityId.trim()),
    filter((communityId) => communityId.length > 0),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly filters$ = combineLatest([
    toObservable(this.selectedStatus),
    toObservable(this.selectedRoleFilter),
    toObservable(this.searchTerm).pipe(
      debounceTime(250),
      map(normalizeSearchTerm),
      distinctUntilChanged()
    ),
  ]).pipe(
    map(
      ([listStatus, roleFilter, query]): ManagedMemberFilters => ({
        listStatus,
        roleFilter,
        query,
      })
    ),
    distinctUntilChanged(
      (left, right) =>
        left.listStatus === right.listStatus
        && left.roleFilter === right.roleFilter
        && left.query === right.query
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly state$ = combineLatest([
    this.communityId$,
    this.filters$,
    this.refresh$.pipe(startWith(undefined)),
  ]).pipe(
    switchMap(([communityId, filters]) =>
      this.repository
        .getManagedMembersPage$({
          communityId,
          status: filters.listStatus,
          roleFilter: filters.roleFilter,
          query: filters.query || null,
          cursor: null,
          limit: 20,
        })
        .pipe(
          switchMap((initialPage) => {
            const initialState = readyState(initialPage);

            return this.loadMore$.pipe(
              exhaustMap((cursor) =>
                this.repository
                  .getManagedMembersPage$({
                    communityId,
                    status: filters.listStatus,
                    roleFilter: filters.roleFilter,
                    query: filters.query || null,
                    cursor,
                    limit: 20,
                  })
                  .pipe(
                    map(
                      (page): ManagedMembersPageEvent => ({
                        type: 'page',
                        page,
                      })
                    ),
                    startWith<ManagedMembersPageEvent>({
                      type: 'loading-more',
                    }),
                    catchError((error: unknown) => {
                      this.reportLoadError(error, filters, true);
                      return of<ManagedMembersPageEvent>({
                        type: 'load-more-error',
                      });
                    })
                  )
              ),
              scan<ManagedMembersPageEvent, ManagedMembersState>(
                reducePageEvent,
                initialState
              ),
              startWith<ManagedMembersState>(initialState)
            );
          }),
          startWith<ManagedMembersState>({
            status: 'loading',
            items: [],
            nextCursor: null,
            loadingMore: false,
          }),
          catchError((error: unknown) => {
            this.reportLoadError(error, filters, false);
            return of<ManagedMembersState>({
              status: 'error',
              items: [],
              nextCursor: null,
              loadingMore: false,
            });
          })
        )
    ),
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
            this.refresh();
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
            this.reportActionError(error, command);
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
  }

  changeRoleFilter(event: Event): void {
    const target = event.target;
    const value = target instanceof HTMLSelectElement ? target.value : '';
    const roleFilter: CommunityManagedMemberRoleFilter | null =
      value === 'all'
      || value === 'leadership'
      || value === 'owner'
      || value === 'admin'
      || value === 'moderator'
      || value === 'member'
        ? value
        : null;

    if (!roleFilter || roleFilter === this.selectedRoleFilter()) return;
    this.selectedRoleFilter.set(roleFilter);
    this.confirmation.set(null);
  }

  updateSearch(event: Event): void {
    const target = event.target;
    const value = target instanceof HTMLInputElement ? target.value : '';
    this.searchTerm.set(value.slice(0, 40));
    this.confirmation.set(null);
  }

  clearSearch(): void {
    if (!this.searchTerm()) return;
    this.searchTerm.set('');
  }

  refresh(): void {
    this.confirmation.set(null);
    this.refresh$.next();
  }

  loadMore(cursor: string | null): void {
    const normalized = String(cursor ?? '').trim();
    if (!normalized) return;
    this.loadMore$.next(normalized);
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

  private reportLoadError(
    error: unknown,
    filters: ManagedMemberFilters,
    append: boolean
  ): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation: append ? 'loadMoreManagedMembers' : 'loadManagedMembers',
      fallbackMessage: append
        ? 'Não foi possível carregar mais participantes agora.'
        : 'Não foi possível carregar os participantes da Comunidade.',
      notification: 'none',
      reasonMessages: COMMUNITY_MEMBER_MANAGEMENT_REASON_MESSAGES,
      metadata: {
        scope: 'CommunityMemberRosterManagementComponent',
        communityId: this.communityId().trim(),
        listStatus: filters.listStatus,
        roleFilter: filters.roleFilter,
        query: filters.query || null,
        append,
      },
    });
  }

  private reportActionError(error: unknown, command: MemberCommand): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation: 'manageCommunityMember',
      fallbackMessage: this.actionErrorMessage(command.action),
      reasonMessages: COMMUNITY_MEMBER_MANAGEMENT_REASON_MESSAGES,
      codeMessages: COMMUNITY_MEMBER_MANAGEMENT_CODE_MESSAGES,
      metadata: {
        scope: 'CommunityMemberRosterManagementComponent',
        communityId: this.communityId().trim(),
        listStatus: this.selectedStatus(),
        roleFilter: this.selectedRoleFilter(),
        memberId: command.item.memberId,
        action: command.action,
        nextRole: command.nextRole,
      },
    });
  }
}
