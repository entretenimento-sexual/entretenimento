import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
} from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  Subject,
  combineLatest,
  catchError,
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
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import {
  type CommunitySearchItem,
  type CommunitySearchMemberRole,
  type CommunitySearchPage,
  type CommunitySearchScope,
} from '../data-access/community-search.model';
import { CommunitySearchRepository } from '../data-access/community-search.repository';

type SearchSectionStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

interface SearchSectionState {
  readonly status: SearchSectionStatus;
  readonly items: readonly CommunitySearchItem[];
  readonly nextCursor: string | null;
  readonly available: boolean;
  readonly loadingMore: boolean;
  readonly loadMoreFailed: boolean;
  readonly errorMessage: string | null;
}

interface SearchLoadRequest {
  readonly cursor: string | null;
  readonly append: boolean;
}

type SearchLoadEvent =
  | { readonly type: 'loading'; readonly request: SearchLoadRequest }
  | {
      readonly type: 'success';
      readonly request: SearchLoadRequest;
      readonly page: CommunitySearchPage;
    }
  | {
      readonly type: 'error';
      readonly request: SearchLoadRequest;
      readonly message: string;
    };

const EMPTY_SECTION: SearchSectionState = Object.freeze({
  status: 'idle',
  items: [],
  nextCursor: null,
  available: true,
  loadingMore: false,
  loadMoreFailed: false,
  errorMessage: null,
});

function mergeItems(
  current: readonly CommunitySearchItem[],
  incoming: readonly CommunitySearchItem[]
): readonly CommunitySearchItem[] {
  const merged = new Map<string, CommunitySearchItem>();

  for (const item of current) {
    merged.set(
      item.type === 'member' ? `member:${item.memberKey}` : `topic:${item.topicId}`,
      item
    );
  }
  for (const item of incoming) {
    merged.set(
      item.type === 'member' ? `member:${item.memberKey}` : `topic:${item.topicId}`,
      item
    );
  }

  return [...merged.values()];
}

function reduceSection(
  state: SearchSectionState,
  event: SearchLoadEvent
): SearchSectionState {
  if (event.type === 'loading') {
    return event.request.append
      ? {
          ...state,
          loadingMore: true,
          loadMoreFailed: false,
          errorMessage: null,
        }
      : { ...EMPTY_SECTION, status: 'loading' };
  }

  if (event.type === 'error') {
    return event.request.append && state.items.length > 0
      ? {
          ...state,
          loadingMore: false,
          loadMoreFailed: true,
          errorMessage: event.message,
        }
      : {
          ...EMPTY_SECTION,
          status: 'error',
          errorMessage: event.message,
        };
  }

  const items = event.request.append
    ? mergeItems(state.items, event.page.items)
    : event.page.items;

  return {
    status: items.length > 0 ? 'ready' : 'empty',
    items,
    nextCursor: event.page.nextCursor,
    available: event.page.available,
    loadingMore: false,
    loadMoreFailed: false,
    errorMessage: null,
  };
}

@Component({
  selector: 'app-community-search',
  standalone: true,
  imports: [
    AsyncPipe,
    ReactiveFormsModule,
    RouterLink,
    PublicUserIdentityComponent,
  ],
  templateUrl: './community-search.component.html',
  styleUrl: './community-search.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunitySearchComponent {
  private readonly repository = inject(CommunitySearchRepository);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly memberLoadRequests$ = new Subject<SearchLoadRequest>();
  private readonly topicLoadRequests$ = new Subject<SearchLoadRequest>();

  readonly communityId = input<string>('');
  readonly canSearchMembers = input<boolean>(false);
  readonly topicRequested = output<string>();
  readonly searchControl = new FormControl('', { nonNullable: true });

  private readonly query$ = this.searchControl.valueChanges.pipe(
    startWith(this.searchControl.value),
    map((value) => value.replace(/\s+/g, ' ').trim().slice(0, 40)),
    debounceTime(250),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly queryState$ = this.query$.pipe(
    map((query) => ({
      query,
      searchable: query.length >= 2,
    })),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly context$ = combineLatest([
    toObservable(this.communityId).pipe(
      map((communityId) => communityId.trim()),
      distinctUntilChanged()
    ),
    toObservable(this.canSearchMembers).pipe(distinctUntilChanged()),
    this.query$,
  ]).pipe(
    map(([communityId, canSearchMembers, query]) => ({
      communityId,
      canSearchMembers,
      query,
    })),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly membersState$ = this.buildSectionState$(
    'members',
    this.memberLoadRequests$
  );
  readonly topicsState$ = this.buildSectionState$(
    'topics',
    this.topicLoadRequests$
  );

  loadMoreMembers(cursor: string | null): void {
    if (!cursor) return;
    this.memberLoadRequests$.next({ cursor, append: true });
  }

  loadMoreTopics(cursor: string | null): void {
    if (!cursor) return;
    this.topicLoadRequests$.next({ cursor, append: true });
  }

  openTopic(topicId: string): void {
    if (!topicId.trim()) return;
    this.topicRequested.emit(topicId.trim());
  }

  itemKey(item: CommunitySearchItem): string {
    return item.type === 'member'
      ? `member:${item.memberKey}`
      : `topic:${item.topicId}`;
  }

  roleLabel(role: CommunitySearchMemberRole): string {
    if (role === 'owner') return 'Proprietário';
    if (role === 'admin') return 'Administração';
    if (role === 'moderator') return 'Moderação';
    return 'Membro';
  }

  private buildSectionState$(
    scope: CommunitySearchScope,
    requests$: Subject<SearchLoadRequest>
  ) {
    return this.context$.pipe(
      switchMap(({ communityId, canSearchMembers, query }) => {
        if (!communityId || query.length < 2) {
          return of<SearchSectionState>(EMPTY_SECTION);
        }

        if (scope === 'members' && !canSearchMembers) {
          return of<SearchSectionState>({
            ...EMPTY_SECTION,
            status: 'empty',
            available: false,
          });
        }

        return requests$.pipe(
          startWith<SearchLoadRequest>({ cursor: null, append: false }),
          exhaustMap((request) =>
            this.repository.searchPage$({
              communityId,
              query,
              scope,
              cursor: request.cursor,
              limit: 12,
            }).pipe(
              map(
                (page): SearchLoadEvent => ({
                  type: 'success',
                  request,
                  page,
                })
              ),
              startWith<SearchLoadEvent>({ type: 'loading', request }),
              catchError((error: unknown) =>
                of<SearchLoadEvent>({
                  type: 'error',
                  request,
                  message: this.reportSearchError(
                    error,
                    scope,
                    communityId,
                    request.append
                  ),
                })
              )
            )
          ),
          scan(reduceSection, EMPTY_SECTION)
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private reportSearchError(
    error: unknown,
    scope: CommunitySearchScope,
    communityId: string,
    append: boolean
  ): string {
    const descriptor = this.applicationError.report(error, {
      feature: 'community',
      operation: append
        ? 'loadMoreCommunitySearch'
        : 'searchCommunity',
      fallbackMessage: append
        ? 'Não foi possível carregar mais resultados agora.'
        : 'Não foi possível concluir a busca nesta Comunidade agora.',
      notification: 'none',
      presentation: { surface: 'inline', severity: 'error' },
      reasonMessages: {
        invalid_community_search_query: 'Revise o termo pesquisado.',
        invalid_community_search_cursor: 'A busca mudou. Inicie novamente.',
        community_search_unavailable: 'A busca interna está temporariamente indisponível.',
        community_search_not_supported: 'Esta busca está disponível apenas em Comunidades.',
      },
      metadata: {
        scope: 'CommunitySearchComponent',
        searchScope: scope,
        communityId,
        append,
      },
    });

    return descriptor.userMessage;
  }
}
