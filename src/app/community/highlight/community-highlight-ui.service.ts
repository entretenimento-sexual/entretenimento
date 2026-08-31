import { Injectable, Injector, inject } from '@angular/core';
import {
  Observable,
  Subject,
  catchError,
  defer,
  map,
  of,
  shareReplay,
  startWith,
  switchMap,
  tap,
  throwError,
} from 'rxjs';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { CommunityFeedItem } from '../data-access/community-feed.model';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';
import {
  CommunityHighlightDuration,
  CommunityHighlightManageRequest,
  CommunityHighlightManageResponse,
  CommunityHighlightSnapshot,
} from '../data-access/community-highlight.model';
import { CommunityHighlightRepository } from '../data-access/community-highlight.repository';
import {
  COMMUNITY_HIGHLIGHT_ACTION_CODE_MESSAGES,
  COMMUNITY_HIGHLIGHT_LOAD_CODE_MESSAGES,
  COMMUNITY_HIGHLIGHT_REASON_MESSAGES,
} from '../presentation/community-highlight-error.messages';

export type CommunityHighlightViewState =
  | {
      status: 'loading';
      communityId: string;
      highlight: null;
      item: null;
      canManage: false;
    }
  | {
      status: 'ready';
      communityId: string;
      highlight: CommunityHighlightSnapshot | null;
      item: CommunityFeedItem | null;
      canManage: boolean;
    }
  | {
      status: 'error';
      communityId: string;
      highlight: null;
      item: null;
      canManage: false;
    };

interface CommunityHighlightContext {
  readonly refresh$: Subject<void>;
  readonly state$: Observable<CommunityHighlightViewState>;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const MAX_CACHED_COMMUNITY_CONTEXTS = 24;

@Injectable({ providedIn: 'root' })
export class CommunityHighlightUiService {
  private readonly injector = inject(Injector);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly contexts = new Map<string, CommunityHighlightContext>();

  state$(communityId: string): Observable<CommunityHighlightViewState> {
    const normalizedCommunityId = communityId.trim();
    if (!SAFE_ID_PATTERN.test(normalizedCommunityId)) {
      return of({
        status: 'error',
        communityId: normalizedCommunityId,
        highlight: null,
        item: null,
        canManage: false,
      });
    }

    const cached = this.contexts.get(normalizedCommunityId);
    if (cached) return cached.state$;

    if (this.contexts.size >= MAX_CACHED_COMMUNITY_CONTEXTS) {
      const oldestKey = this.contexts.keys().next().value as string | undefined;
      if (oldestKey) this.contexts.delete(oldestKey);
    }

    const refresh$ = new Subject<void>();
    const state$ = refresh$.pipe(
      startWith(undefined),
      switchMap(() => this.loadState$(normalizedCommunityId)),
      shareReplay({ bufferSize: 1, refCount: true })
    );
    this.contexts.set(normalizedCommunityId, { refresh$, state$ });
    return state$;
  }

  refresh(communityId: string): void {
    const normalizedCommunityId = communityId.trim();
    this.contexts.get(normalizedCommunityId)?.refresh$.next();
  }

  manage$(
    request: CommunityHighlightManageRequest
  ): Observable<CommunityHighlightManageResponse> {
    const communityId = request.communityId.trim();

    return defer(() =>
      this.injector.get(CommunityHighlightRepository).manage$(request)
    ).pipe(
      tap((result) => {
        this.refresh(communityId);
        this.showSuccess(result);
      }),
      catchError((error: unknown) => {
        this.applicationError.report(error, {
          feature: 'community',
          operation: 'manageHighlight',
          fallbackMessage: request.action === 'pin'
            ? 'Não foi possível fixar esta publicação agora.'
            : 'Não foi possível desafixar esta publicação agora.',
          reasonMessages: COMMUNITY_HIGHLIGHT_REASON_MESSAGES,
          codeMessages: COMMUNITY_HIGHLIGHT_ACTION_CODE_MESSAGES,
          metadata: {
            scope: 'CommunityHighlightUiService',
            action: request.action,
          },
        });
        return throwError(() => error);
      })
    );
  }

  private loadState$(communityId: string): Observable<CommunityHighlightViewState> {
    return defer(() =>
      this.injector.get(CommunityHighlightRepository).get$({ communityId })
    ).pipe(
      switchMap((response) => {
        if (!response.highlight) {
          return of<CommunityHighlightViewState>({
            status: 'ready',
            communityId,
            highlight: null,
            item: null,
            canManage: response.canManage,
          });
        }

        const highlight = response.highlight;
        return defer(() =>
          this.injector.get(CommunityFeedRepository).getItems$({
            communityId,
            view: 'feed',
            postIds: [highlight.targetId],
          })
        ).pipe(
          map((page) =>
            page.items.find((item) => item.postId === highlight.targetId) ?? null
          ),
          catchError((error: unknown) => {
            this.applicationError.report(error, {
              feature: 'community',
              operation: 'hydrateHighlight',
              fallbackMessage:
                'A publicação fixada não pôde ser carregada neste momento.',
              notification: 'none',
              metadata: {
                scope: 'CommunityHighlightUiService',
              },
            });
            return of(null);
          }),
          map((item): CommunityHighlightViewState => ({
            status: 'ready',
            communityId,
            highlight,
            item,
            canManage: response.canManage,
          }))
        );
      }),
      startWith<CommunityHighlightViewState>({
        status: 'loading',
        communityId,
        highlight: null,
        item: null,
        canManage: false,
      }),
      catchError((error: unknown) => {
        this.applicationError.report(error, {
          feature: 'community',
          operation: 'loadHighlight',
          fallbackMessage:
            'Não foi possível carregar a publicação fixada agora.',
          notification: 'none',
          reasonMessages: COMMUNITY_HIGHLIGHT_REASON_MESSAGES,
          codeMessages: COMMUNITY_HIGHLIGHT_LOAD_CODE_MESSAGES,
          metadata: {
            scope: 'CommunityHighlightUiService',
          },
        });
        return of<CommunityHighlightViewState>({
          status: 'error',
          communityId,
          highlight: null,
          item: null,
          canManage: false,
        });
      })
    );
  }

  private showSuccess(result: CommunityHighlightManageResponse): void {
    try {
      if (result.action === 'unpin') {
        this.errorNotifier.showSuccess(
          result.deduplicated
            ? 'A publicação já não estava fixada.'
            : 'Publicação desafixada.'
        );
        return;
      }

      this.errorNotifier.showSuccess(
        result.deduplicated
          ? 'A publicação fixada já estava confirmada.'
          : `Publicação fixada ${this.durationSuccessSuffix(result.highlight?.duration)}.`
      );
    } catch {
      // O card reativo confirma visualmente a alteração mesmo sem snackbar.
    }
  }

  private durationSuccessSuffix(
    duration: CommunityHighlightDuration | undefined
  ): string {
    switch (duration) {
      case '24h':
        return 'por 24 horas';
      case '3d':
        return 'por 3 dias';
      case '30d':
        return 'por 30 dias';
      case 'until_unpinned':
        return 'até ser desafixada';
      case '7d':
      default:
        return 'por 7 dias';
    }
  }
}
