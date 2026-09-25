// src/app/community/members/community-members-page.component.ts
import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  Subject,
  catchError,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  exhaustMap,
  map,
  of,
  scan,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs';

import { PublicUserIdentityComponent } from 'src/app/core/components/public-user-identity/public-user-identity.component';
import { ApplicationErrorDescriptor, ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import {
  CommunityMemberSearchItem,
  CommunityMemberSearchPage,
} from '../data-access/community-member-search.model';
import { CommunityMemberSearchRepository } from '../data-access/community-member-search.repository';
import {
  CommunityMemberRosterItem,
  CommunityMemberRosterPage,
  CommunityMemberRosterRole,
} from '../data-access/community-member-roster.model';
import { CommunityMemberRosterRepository } from '../data-access/community-member-roster.repository';
import {
  COMMUNITY_MEMBER_ROSTER_CODE_MESSAGES,
  COMMUNITY_MEMBER_ROSTER_REASON_MESSAGES,
} from '../presentation/community-member-roster-error.messages';

type MemberRosterStatus = 'loading' | 'ready' | 'empty' | 'error';

interface MemberRosterState {
  readonly communityId: string;
  readonly status: MemberRosterStatus;
  readonly items: readonly CommunityMemberRosterItem[];
  readonly nextCursor: string | null;
  readonly memberCount: number;
  readonly loadingMore: boolean;
  readonly loadMoreFailed: boolean;
  readonly errorMessage: string | null;
  readonly restartRequired: boolean;
}

interface LoadRequest {
  readonly cursor: string | null;
  readonly append: boolean;
}

type LoadEvent =
  | { type: 'loading'; request: LoadRequest }
  | { type: 'success'; request: LoadRequest; page: CommunityMemberRosterPage }
  | { type: 'error'; request: LoadRequest; error: ApplicationErrorDescriptor };

function initialState(communityId: string): MemberRosterState {
  return {
    communityId,
    status: 'loading',
    items: [],
    nextCursor: null,
    memberCount: 0,
    loadingMore: false,
    loadMoreFailed: false,
    errorMessage: null,
    restartRequired: false,
  };
}


type MemberSearchStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

interface MemberSearchState {
  readonly communityId: string;
  readonly query: string;
  readonly active: boolean;
  readonly status: MemberSearchStatus;
  readonly items: readonly CommunityMemberSearchItem[];
  readonly nextCursor: string | null;
  readonly loadingMore: boolean;
  readonly loadMoreFailed: boolean;
  readonly errorMessage: string | null;
  readonly restartRequired: boolean;
}

type SearchLoadEvent =
  | { type: 'loading'; request: LoadRequest }
  | { type: 'success'; request: LoadRequest; page: CommunityMemberSearchPage }
  | { type: 'error'; request: LoadRequest; error: ApplicationErrorDescriptor };

function initialSearchState(
  communityId: string,
  query: string
): MemberSearchState {
  return {
    communityId,
    query,
    active: query.length >= 2,
    status: query.length >= 2 ? 'loading' : 'idle',
    items: [],
    nextCursor: null,
    loadingMore: false,
    loadMoreFailed: false,
    errorMessage: null,
    restartRequired: false,
  };
}

function mergeSearchMembers(
  current: readonly CommunityMemberSearchItem[],
  incoming: readonly CommunityMemberSearchItem[]
): readonly CommunityMemberSearchItem[] {
  const merged = new Map<string, CommunityMemberSearchItem>();
  for (const item of current) merged.set(item.memberKey, item);
  for (const item of incoming) merged.set(item.memberKey, item);
  return [...merged.values()];
}

function reduceSearchState(
  state: MemberSearchState,
  event: SearchLoadEvent
): MemberSearchState {
  if (event.type === 'loading') {
    return event.request.append
      ? {
          ...state,
          loadingMore: true,
          loadMoreFailed: false,
          errorMessage: null,
          restartRequired: false,
        }
      : initialSearchState(state.communityId, state.query);
  }

  if (event.type === 'error') {
    const accessDenied = [
      'unauthenticated',
      'permission-denied',
      'not-found',
      'failed-precondition',
    ].includes(event.error.code ?? '');

    return event.request.append && state.items.length > 0 && !accessDenied
      ? {
          ...state,
          loadingMore: false,
          loadMoreFailed: true,
          errorMessage: event.error.userMessage,
          restartRequired: event.error.reason === 'community_search_cursor_invalid',
        }
      : {
          ...initialSearchState(state.communityId, state.query),
          status: 'error',
          errorMessage: event.error.userMessage,
        };
  }

  const items = event.request.append
    ? mergeSearchMembers(state.items, event.page.items)
    : event.page.items;

  return {
    ...state,
    status: items.length > 0 ? 'ready' : 'empty',
    items,
    nextCursor: event.page.nextCursor,
    loadingMore: false,
    loadMoreFailed: false,
    errorMessage: null,
    restartRequired: false,
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
          errorMessage: null,
          restartRequired: false,
        }
      : initialState(state.communityId);
  }

  if (event.type === 'error') {
    const accessDenied = ['unauthenticated', 'permission-denied', 'not-found', 'failed-precondition']
      .includes(event.error.code ?? '');
    return event.request.append && state.items.length > 0 && !accessDenied
      ? {
          ...state,
          loadingMore: false,
          loadMoreFailed: true,
          errorMessage: event.error.userMessage,
          restartRequired: event.error.reason === 'invalid_community_member_roster_cursor',
        }
      : {
          ...initialState(state.communityId),
          status: 'error',
          errorMessage: event.error.userMessage,
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
    errorMessage: null,
    restartRequired: false,
  };
}

@Component({
  selector: 'app-community-members-page',
  standalone: true,
  imports: [AsyncPipe, ReactiveFormsModule, RouterLink, PublicUserIdentityComponent],
  templateUrl: './community-members-page.component.html',
  styleUrl: './community-members-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityMembersPageComponent {
  readonly embedded = input(false);

  private readonly route = inject(ActivatedRoute);
  private readonly repository = inject(CommunityMemberRosterRepository);
  private readonly searchRepository = inject(CommunityMemberSearchRepository);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly loadRequests$ = new Subject<LoadRequest>();
  private readonly searchLoadRequests$ = new Subject<LoadRequest>();

  readonly searchControl = new FormControl('', { nonNullable: true });

  private readonly communityId$ = this.route.paramMap.pipe(
    map((params) => String(params.get('communityId') ?? '').trim()),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly searchQuery$ = this.searchControl.valueChanges.pipe(
    map((value) => String(value ?? '').trim()),
    debounceTime(300),
    distinctUntilChanged(),
    startWith(''),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly state$ = this.communityId$.pipe(
    switchMap((communityId) => {
      if (!communityId) {
        const error = this.reportLoadError(
          new Error('Identificador da Comunidade ausente.'),
          communityId,
          false
        );
        return of<MemberRosterState>({
          ...initialState(''),
          status: 'error',
          errorMessage: error.userMessage,
        });
      }

      return this.loadRequests$.pipe(
        startWith<LoadRequest>({ cursor: null, append: false }),
        exhaustMap((request) =>
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
                const descriptor = this.reportLoadError(error, communityId, request.append);
                return of<LoadEvent>({ type: 'error', request, error: descriptor });
              })
            )
        ),
        scan(reduceState, initialState(communityId))
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly searchState$ = combineLatest([
    this.communityId$,
    this.searchQuery$,
  ]).pipe(
    switchMap(([communityId, query]) => {
      if (!communityId || query.length < 2) {
        return of(initialSearchState(communityId, query));
      }

      return this.searchLoadRequests$.pipe(
        startWith<LoadRequest>({ cursor: null, append: false }),
        exhaustMap((request) =>
          this.searchRepository
            .searchPage$({
              communityId,
              query,
              cursor: request.cursor,
              limit: 20,
            })
            .pipe(
              map((page): SearchLoadEvent => ({
                type: 'success',
                request,
                page,
              })),
              startWith<SearchLoadEvent>({ type: 'loading', request }),
              catchError((error: unknown) => {
                const descriptor = this.reportSearchError(
                  error,
                  communityId,
                  query,
                  request.append
                );
                return of<SearchLoadEvent>({
                  type: 'error',
                  request,
                  error: descriptor,
                });
              })
            )
        ),
        scan(reduceSearchState, initialSearchState(communityId, query))
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

  retrySearch(): void {
    this.searchLoadRequests$.next({ cursor: null, append: false });
  }

  loadMoreSearch(cursor: string | null): void {
    if (!cursor) return;
    this.searchLoadRequests$.next({ cursor, append: true });
  }

  clearSearch(): void {
    this.searchControl.setValue('');
  }

  roleLabel(role: CommunityMemberRosterRole): string {
    if (role === 'owner') return 'Proprietário';
    if (role === 'admin') return 'Administração';
    if (role === 'moderator') return 'Moderação';
    return 'Membro';
  }

  private reportSearchError(
    error: unknown,
    communityId: string,
    query: string,
    append: boolean
  ): ApplicationErrorDescriptor {
    return this.applicationError.report(error, {
      feature: 'community',
      operation: append ? 'loadMoreCommunityMemberSearch' : 'searchCommunityMembers',
      fallbackMessage: append
        ? 'Não foi possível carregar mais resultados agora.'
        : 'Não foi possível buscar integrantes desta Comunidade agora.',
      notification: 'none',
      presentation: { surface: 'inline', severity: 'error' },
      reasonMessages: COMMUNITY_MEMBER_ROSTER_REASON_MESSAGES,
      codeMessages: COMMUNITY_MEMBER_ROSTER_CODE_MESSAGES,
      metadata: {
        scope: 'CommunityMembersPageComponent',
        communityId,
        queryLength: query.length,
        append,
      },
    });
  }

  private reportLoadError(
    error: unknown,
    communityId: string,
    append: boolean
  ): ApplicationErrorDescriptor {
    return this.applicationError.report(error, {
      feature: 'community',
      operation: append ? 'loadMoreCommunityMembers' : 'loadCommunityMembers',
      fallbackMessage: append
        ? 'Não foi possível carregar mais integrantes agora.'
        : 'Não foi possível carregar os integrantes desta Comunidade agora.',
      notification: 'none',
      presentation: { surface: 'inline', severity: 'error' },
      reasonMessages: COMMUNITY_MEMBER_ROSTER_REASON_MESSAGES,
      codeMessages: COMMUNITY_MEMBER_ROSTER_CODE_MESSAGES,
      metadata: {
        scope: 'CommunityMembersPageComponent',
        communityId,
        append,
      },
    });
  }
}
