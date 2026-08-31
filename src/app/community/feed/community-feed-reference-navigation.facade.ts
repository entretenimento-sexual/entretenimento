import { ElementRef, Injectable, inject, signal } from '@angular/core';
import {
  EMPTY,
  Observable,
  Subject,
  catchError,
  defaultIfEmpty,
  filter,
  map,
  of,
  share,
  switchMap,
  take,
  takeUntil,
  tap,
  throwError,
  timer,
} from 'rxjs';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { CommunityFeedItem, CommunityFeedView } from '../data-access/community-feed.model';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';
import { CommunityPreviewSourceType } from '../data-access/community-preview.model';
import { COMMUNITY_FEED_REFERENCE_CODE_MESSAGES } from '../presentation/community-error.messages';

export type CommunityFeedReferenceNavigationState =
  | { status: 'idle'; postId: null }
  | { status: 'loading' | 'error'; postId: string };

export interface CommunityFeedReferenceNavigationContext {
  communityId: string;
  view: CommunityFeedView;
  sourceType: CommunityPreviewSourceType;
}

export interface CommunityFeedReferenceNavigationTarget {
  postId: string;
  sequence: number;
  target: ElementRef<HTMLElement>;
}

type RenderedPostResolver = (postId: string) => ElementRef<HTMLElement> | null;

interface CommunityFeedReferenceNavigationRequest {
  postId: string;
  sequence: number;
  context: CommunityFeedReferenceNavigationContext;
  findRenderedPost: RenderedPostResolver;
}

const COMMUNITY_REFERENCE_RENDER_TIMEOUT_MS = 1_200;

@Injectable()
export class CommunityFeedReferenceNavigationFacade {
  private readonly repository = inject(CommunityFeedRepository);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly navigationRequests$ =
    new Subject<CommunityFeedReferenceNavigationRequest>();
  private readonly referencedItems$ = new Subject<CommunityFeedItem>();
  private sequence = 0;

  readonly navigationState = signal<CommunityFeedReferenceNavigationState>({
    status: 'idle',
    postId: null,
  });
  readonly referencedItem$ = this.referencedItems$.asObservable();
  readonly navigationTarget$: Observable<CommunityFeedReferenceNavigationTarget> =
    this.navigationRequests$.pipe(
      switchMap((request) => {
        this.navigationState.set({
          status: 'loading',
          postId: request.postId,
        });

        return this.ensureReferencedPost$(request).pipe(
          switchMap(() => this.waitForRenderedPost$(request)),
          map((target): CommunityFeedReferenceNavigationTarget => ({
            postId: request.postId,
            sequence: request.sequence,
            target,
          })),
          tap(() => {
            this.navigationState.set({
              status: 'idle',
              postId: null,
            });
          }),
          catchError((error: unknown) => {
            this.navigationState.set({
              status: 'error',
              postId: request.postId,
            });
            this.reportNavigationError(error, request.context);
            return EMPTY;
          })
        );
      }),
      // Mantém uma única execução mesmo que novos consumidores observem o alvo.
      // O cancelamento entre cliques continua sendo responsabilidade do switchMap.
      share()
    );

  navigate(
    postId: string,
    context: CommunityFeedReferenceNavigationContext,
    findRenderedPost: RenderedPostResolver
  ): void {
    const normalizedPostId = postId.trim();
    if (!normalizedPostId) return;

    this.sequence += 1;
    this.navigationRequests$.next({
      postId: normalizedPostId,
      sequence: this.sequence,
      context: {
        communityId: context.communityId.trim(),
        view: context.view,
        sourceType: context.sourceType,
      },
      findRenderedPost,
    });
  }

  private ensureReferencedPost$(
    request: CommunityFeedReferenceNavigationRequest
  ): Observable<void> {
    if (request.findRenderedPost(request.postId)) {
      return of(undefined);
    }

    if (!request.context.communityId) {
      return throwError(() => new Error(
        'Comunidade não disponível para localizar a publicação original.'
      ));
    }

    return this.repository.getItems$({
      communityId: request.context.communityId,
      view: request.context.view,
      postIds: [request.postId],
    }).pipe(
      map((page) => page.items.find((item) => item.postId === request.postId) ?? null),
      tap((item) => {
        if (!item) {
          throw new Error('Publicação original não encontrada no Mural.');
        }
        this.referencedItems$.next(item);
      }),
      map(() => undefined)
    );
  }

  private waitForRenderedPost$(
    request: CommunityFeedReferenceNavigationRequest
  ): Observable<ElementRef<HTMLElement>> {
    const existing = request.findRenderedPost(request.postId);
    if (existing) return of(existing);

    return timer(0, 16).pipe(
      map(() => request.findRenderedPost(request.postId)),
      filter(
        (target): target is ElementRef<HTMLElement> => target !== null
      ),
      take(1),
      takeUntil(timer(COMMUNITY_REFERENCE_RENDER_TIMEOUT_MS)),
      defaultIfEmpty(null),
      map((target) => {
        if (!target) {
          throw new Error(
            'A publicação original foi carregada, mas não pôde ser exibida no Mural.'
          );
        }
        return target;
      })
    );
  }

  private reportNavigationError(
    error: unknown,
    context: CommunityFeedReferenceNavigationContext
  ): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation: 'navigateReference',
      fallbackMessage:
        'A publicação original não está disponível neste momento.',
      notification: 'none',
      codeMessages: COMMUNITY_FEED_REFERENCE_CODE_MESSAGES,
      metadata: {
        scope: 'CommunityFeedReferenceNavigationFacade',
        view: context.view,
        sourceType: context.sourceType,
      },
    });
  }
}
