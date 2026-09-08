// src/app/community/members/community-members-page.component.ts
import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  Subject,
  catchError,
  distinctUntilChanged,
  map,
  of,
  scan,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs';

import { PublicUserIdentityComponent } from 'src/app/core/components/public-user-identity/public-user-identity.component';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import {
  CommunityMemberRosterItem,
  CommunityMemberRosterPage,
  CommunityMemberRosterRole,
} from '../data-access/community-member-roster.model';
import { CommunityMemberRosterRepository } from '../data-access/community-member-roster.repository';

type MemberRosterStatus = 'loading' | 'ready' | 'empty' | 'error';

interface MemberRosterState {
  readonly communityId: string;
  readonly status: MemberRosterStatus;
  readonly items: readonly CommunityMemberRosterItem[];
  readonly nextCursor: string | null;
  readonly memberCount: number;
  readonly loadingMore: boolean;
  readonly loadMoreFailed: boolean;
}

interface LoadRequest {
  readonly cursor: string | null;
  readonly append: boolean;
}

type LoadEvent =
  | { type: 'loading'; request: LoadRequest }
  | { type: 'success'; request: LoadRequest; page: CommunityMemberRosterPage }
  | { type: 'error'; request: LoadRequest };

function initialState(communityId: string): MemberRosterState {
  return {
    communityId,
    status: 'loading',
    items: [],
    nextCursor: null,
    memberCount: 0,
    loadingMore: false,
    loadMoreFailed: false,
  };
}

function mergeMembers(
  current: readonly CommunityMemberRosterItem[],
  incoming: readonly CommunityMemberRosterItem[]
): readonly CommunityMemberRosterItem[] {
  const merged = new Map<string, CommunityMemberRosterItem>();
  for (const item of current) merged.set(item.memberKey, item);
  for (const item of incoming) merged.set(item.memberKey, item);
  return [...merged.values()];
}

function reduceState(
  state: MemberRosterState,
  event: LoadEvent
): MemberRosterState {
  if (event.type === 'loading') {
    return event.request.append
      ? {
          ...state,
          loadingMore: true,
          loadMoreFailed: false,
        }
      : initialState(state.communityId);
  }

  if (event.type === 'error') {
    return event.request.append && state.items.length > 0
      ? {
          ...state,
          loadingMore: false,
          loadMoreFailed: true,
        }
      : {
          ...initialState(state.communityId),
          status: 'error',
        };
  }

  const items = event.request.append
    ? mergeMembers(state.items, event.page.items)
    : event.page.items;

  return {
    communityId: state.communityId,
    status: items.length > 0 ? 'ready' : 'empty',
    items,
    nextCursor: event.page.nextCursor,
    memberCount: event.page.memberCount,
    loadingMore: false,
    loadMoreFailed: false,
  };
}

@Component({
  selector: 'app-community-members-page',
  standalone: true,
  imports: [AsyncPipe, RouterLink, PublicUserIdentityComponent],
  templateUrl: './community-members-page.component.html',
  styleUrl: './community-members-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityMembersPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly repository = inject(CommunityMemberRosterRepository);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly loadRequests$ = new Subject<LoadRequest>();

  readonly state$ = this.route.paramMap.pipe(
    map((params) => String(params.get('communityId') ?? '').trim()),
    distinctUntilChanged(),
    switchMap((communityId) => {
      if (!communityId) {
        this.reportLoadError(
          new Error('Identificador da Comunidade ausente.'),
          communityId,
          false
        );
        return of<MemberRosterState>({
          ...initialState(''),
          status: 'error',
        });
      }

      return this.loadRequests$.pipe(
        startWith<LoadRequest>({ cursor: null, append: false }),
        switchMap((request) =>
          this.repository
            .getPage$({
              communityId,
              cursor: request.cursor,
              limit: 20,
            })
            .pipe(
              map((page): LoadEvent => ({ type: 'success', request, page })),
              startWith<LoadEvent>({ type: 'loading', request }),
              catchError((error: unknown) => {
                this.reportLoadError(error, communityId, request.append);
                return of<LoadEvent>({ type: 'error', request });
              })
            )
        ),
        scan(reduceState, initialState(communityId))
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  retry(): void {
    this.loadRequests$.next({ cursor: null, append: false });
  }

  loadMore(cursor: string | null): void {
    if (!cursor) return;
    this.loadRequests$.next({ cursor, append: true });
  }

  roleLabel(role: CommunityMemberRosterRole): string {
    if (role === 'owner') return 'Proprietário';
    if (role === 'admin') return 'Administração';
    if (role === 'moderator') return 'Moderação';
    return 'Membro';
  }

  private reportLoadError(
    error: unknown,
    communityId: string,
    append: boolean
  ): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation: append ? 'loadMoreCommunityMembers' : 'loadCommunityMembers',
      fallbackMessage: append
        ? 'Não foi possível carregar mais integrantes agora.'
        : 'Não foi possível carregar os integrantes desta Comunidade agora.',
      notification: 'none',
      metadata: {
        scope: 'CommunityMembersPageComponent',
        communityId,
        append,
      },
    });
  }
}
