// src/app/community/feed/community-feed-moderation.facade.ts
import { Injectable, inject, signal } from '@angular/core';
import { FormControl, Validators } from '@angular/forms';
import {
  Subject,
  catchError,
  exhaustMap,
  map,
  of,
  shareReplay,
  startWith,
  tap,
} from 'rxjs';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import {
  CommunityFeedItem,
  CommunityFeedPostAction,
  CommunityFeedPostActionRequest,
  CommunityFeedView,
} from '../data-access/community-feed.model';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';
import { CommunityPreviewSourceType } from '../data-access/community-preview.model';
import {
  COMMUNITY_FEED_POST_ACTION_CODE_MESSAGES,
  COMMUNITY_FEED_POST_REASON_MESSAGES,
} from '../presentation/community-error.messages';
import { createCommunityFeedRequestId } from './community-feed-request-id';

export type CommunityFeedPostActionState =
  | { status: 'idle'; postId: null; action: null }
  | {
      status: 'loading' | 'error';
      postId: string;
      action: CommunityFeedPostAction;
    };

export interface CommunityFeedModerationContext {
  readonly communityId: string;
  readonly view: CommunityFeedView;
  readonly sourceType: CommunityPreviewSourceType;
}

interface ModerationEnvelope {
  readonly request: CommunityFeedPostActionRequest;
  readonly context: CommunityFeedModerationContext;
}

@Injectable()
export class CommunityFeedModerationFacade {
  private readonly repository = inject(CommunityFeedRepository);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly requests$ = new Subject<ModerationEnvelope>();
  private readonly removedPostSubject = new Subject<string>();
  private readonly pendingRequestIds = new Map<string, string>();

  readonly actionPostId = signal<string | null>(null);
  readonly actionMode = signal<CommunityFeedPostAction | null>(null);
  readonly removalReason = new FormControl('', {
    nonNullable: true,
    validators: [
      Validators.required,
      Validators.minLength(3),
      Validators.maxLength(240),
    ],
  });
  readonly removedPost$ = this.removedPostSubject.asObservable();

  readonly state$ = this.requests$.pipe(
    exhaustMap(({ request, context }) =>
      this.repository.moderatePost$(request).pipe(
        tap((result) => {
          this.pendingRequestIds.delete(
            this.actionRequestKey(result.postId, result.action)
          );
          this.actionPostId.set(null);
          this.actionMode.set(null);
          this.removalReason.reset('');
          this.removedPostSubject.next(result.postId);
          this.showSuccess(result.action, result.deduplicated);
        }),
        map((): CommunityFeedPostActionState => ({
          status: 'idle',
          postId: null,
          action: null,
        })),
        startWith<CommunityFeedPostActionState>({
          status: 'loading',
          postId: request.postId,
          action: request.action,
        }),
        catchError((error: unknown) => {
          this.reportError(error, request.action, context);
          return of<CommunityFeedPostActionState>({
            status: 'error',
            postId: request.postId,
            action: request.action,
          });
        })
      )
    ),
    startWith<CommunityFeedPostActionState>({
      status: 'idle',
      postId: null,
      action: null,
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  request(item: CommunityFeedItem, action: CommunityFeedPostAction): void {
    const allowed = action === 'delete_own'
      ? item.capabilities.canDeleteOwn
      : item.capabilities.canModerate;
    if (!allowed) return;

    this.actionPostId.set(item.postId);
    this.actionMode.set(action);
    this.removalReason.reset('');
  }

  cancel(): void {
    const postId = this.actionPostId();
    const action = this.actionMode();
    if (postId && action) {
      this.pendingRequestIds.delete(this.actionRequestKey(postId, action));
    }
    this.actionPostId.set(null);
    this.actionMode.set(null);
    this.removalReason.reset('');
  }

  confirm(
    item: CommunityFeedItem,
    context: CommunityFeedModerationContext
  ): void {
    const action = this.actionMode();
    if (!action || this.actionPostId() !== item.postId) return;

    const allowed = action === 'delete_own'
      ? item.capabilities.canDeleteOwn
      : item.capabilities.canModerate;
    if (!allowed) return;

    const reason = action === 'remove'
      ? this.removalReason.value.trim()
      : null;
    if (action === 'remove' && this.removalReason.invalid) {
      this.removalReason.markAsTouched();
      this.errorNotifier.showWarning('Informe o motivo da remoção.');
      return;
    }

    const key = this.actionRequestKey(item.postId, action);
    const requestId =
      this.pendingRequestIds.get(key) ?? createCommunityFeedRequestId();
    this.pendingRequestIds.set(key, requestId);

    this.requests$.next({
      context,
      request: {
        requestId,
        communityId: context.communityId,
        postId: item.postId,
        action,
        reason,
      },
    });
  }

  private actionRequestKey(
    postId: string,
    action: CommunityFeedPostAction
  ): string {
    return `${action}:${postId}`;
  }

  private showSuccess(
    action: CommunityFeedPostAction,
    deduplicated: boolean
  ): void {
    try {
      const message = deduplicated
        ? 'A ação já estava confirmada.'
        : action === 'delete_own'
          ? 'Mensagem excluída.'
          : 'Mensagem removida do Mural.';
      this.errorNotifier.showSuccess(message);
    } catch {
      // O stream realtime confirma a remoção visualmente.
    }
  }

  private reportError(
    error: unknown,
    action: CommunityFeedPostAction,
    context: CommunityFeedModerationContext
  ): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation: 'moderatePost',
      fallbackMessage: action === 'delete_own'
        ? 'Não foi possível excluir a mensagem agora.'
        : 'Não foi possível remover a mensagem agora.',
      reasonMessages: COMMUNITY_FEED_POST_REASON_MESSAGES,
      codeMessages: COMMUNITY_FEED_POST_ACTION_CODE_MESSAGES,
      metadata: {
        scope: 'CommunityFeedModerationFacade',
        action,
        view: context.view,
        sourceType: context.sourceType,
      },
    });
  }
}
