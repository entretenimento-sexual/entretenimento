// -----------------------------------------------------------------------------
// COMMUNITY FEED COMMENTS / CONVERSA LEGADA
// -----------------------------------------------------------------------------
// A timeline principal do Mural é canônica. Novas mensagens dirigidas à
// publicação raiz são criadas como CommunityFeedItem com replyToPostId e passam
// a ocupar sua posição cronológica no Mural. Esta superfície conserva a leitura
// dos comments legados e permite responder a eles até a migração do histórico.
// -----------------------------------------------------------------------------

import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  EMPTY,
  Observable,
  catchError,
  combineLatest,
  concatMap,
  distinctUntilChanged,
  exhaustMap,
  filter,
  map,
  merge,
  of,
  scan,
  shareReplay,
  skip,
  startWith,
  Subject,
  switchMap,
  tap,
} from 'rxjs';

import { PublicUserIdentityComponent } from 'src/app/core/components/public-user-identity/public-user-identity.component';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { ReportContentButtonComponent } from 'src/app/shared/components-globais/moderation-report/report-content-button/report-content-button.component';
import {
  CommunityFeedCommentAction,
  CommunityFeedCommentActionRequest,
  CommunityFeedCommentCreateRequest,
  CommunityFeedCommentItem,
  CommunityFeedCommentPage,
} from '../data-access/community-feed-comment.model';
import { CommunityFeedCommentRepository } from '../data-access/community-feed-comment.repository';
import {
  CommunityFeedPostCreateRequest,
  CommunityFeedPostCreateResponse,
} from '../data-access/community-feed.model';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';
import { CommunityFeedTimeTickerService } from '../feed/community-feed-time-ticker.service';
import {
  formatCommunityFeedIso,
  formatCommunityFeedTime,
} from '../feed/community-feed-time.util';
import {
  COMMUNITY_FEED_CONVERSATION_ACTION_CODE_MESSAGES,
  COMMUNITY_FEED_CONVERSATION_CREATE_CODE_MESSAGES,
  COMMUNITY_FEED_CONVERSATION_REASON_MESSAGES,
} from '../presentation/community-error.messages';

interface CommentLoadRequest {
  cursor: string | null;
  append: boolean;
  preserve?: boolean;
}

type CommentLoadState =
  | { status: 'loading'; items: readonly CommunityFeedCommentItem[]; nextCursor: null; loadingMore: false }
  | { status: 'error'; items: readonly CommunityFeedCommentItem[]; nextCursor: null; loadingMore: false }
  | { status: 'empty'; items: readonly CommunityFeedCommentItem[]; nextCursor: null; loadingMore: false }
  | { status: 'ready'; items: readonly CommunityFeedCommentItem[]; nextCursor: string | null; loadingMore: boolean };

type CommentLoadEvent =
  | { type: 'loading'; request: CommentLoadRequest }
  | { type: 'success'; request: CommentLoadRequest; page: CommunityFeedCommentPage }
  | { type: 'error'; request: CommentLoadRequest };

type CommentWriteState = 'idle' | 'loading' | 'error';

type ConversationCreateCommand =
  | {
      kind: 'feed_reply';
      request: CommunityFeedPostCreateRequest;
    }
  | {
      kind: 'legacy_comment';
      request: CommunityFeedCommentCreateRequest;
    };

type ConversationCreateResult =
  | {
      kind: 'feed_reply';
      request: CommunityFeedPostCreateRequest;
      response: CommunityFeedPostCreateResponse;
    }
  | {
      kind: 'legacy_comment';
      request: CommunityFeedCommentCreateRequest;
      response: {
        communityId: string;
        postId: string;
        commentId: string;
        commentCount: number;
        created: boolean;
        deduplicated: boolean;
      };
    };

interface CommentActionState {
  status: 'idle' | 'loading' | 'error';
  commentId: string | null;
  action: CommunityFeedCommentAction | null;
}

const INITIAL_STATE: CommentLoadState = {
  status: 'loading',
  items: [],
  nextCursor: null,
  loadingMore: false,
};

function sortConversationItems(
  items: readonly CommunityFeedCommentItem[]
): CommunityFeedCommentItem[] {
  return [...items].sort((left, right) =>
    left.createdAt - right.createdAt || left.commentId.localeCompare(right.commentId)
  );
}

function reduceState(
  state: CommentLoadState,
  event: CommentLoadEvent
): CommentLoadState {
  const preserveCurrent =
    (event.request.append || event.request.preserve === true)
    && state.items.length > 0;

  if (event.type === 'loading') {
    return preserveCurrent
      ? {
          ...state,
          status: 'ready',
          loadingMore: event.request.append,
        }
      : INITIAL_STATE;
  }
  if (event.type === 'error') {
    return preserveCurrent
      ? { ...state, status: 'ready', loadingMore: false }
      : { status: 'error', items: [], nextCursor: null, loadingMore: false };
  }

  const pageItems = sortConversationItems(event.page.items);
  // A callable legada pagina do mais novo para o mais antigo. Ao pedir mensagens
  // anteriores, elas entram no início para manter a leitura cronológica.
  const items = event.request.append
    ? [
        ...pageItems.filter(
          (candidate) => !state.items.some(
            (current) => current.commentId === candidate.commentId
          )
        ),
        ...state.items,
      ]
    : pageItems;

  return items.length === 0
    ? { status: 'empty', items: [], nextCursor: null, loadingMore: false }
    : {
        status: 'ready',
        items,
        nextCursor: event.page.nextCursor,
        loadingMore: false,
      };
}

@Component({
  selector: 'app-community-feed-comments',
  standalone: true,
  imports: [
    AsyncPipe,
    PublicUserIdentityComponent,
    ReactiveFormsModule,
    ReportContentButtonComponent,
  ],
  templateUrl: './community-feed-comments.component.html',
  styleUrl: './community-feed-comments.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityFeedCommentsComponent implements OnDestroy {
  private readonly repository = inject(CommunityFeedCommentRepository);
  private readonly feedRepository = inject(CommunityFeedRepository);
  private readonly notification = inject(ErrorNotificationService);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly timeTicker = inject(CommunityFeedTimeTickerService);
  private readonly loadRequests$ = new Subject<CommentLoadRequest>();
  private readonly createRequests$ = new Subject<ConversationCreateCommand>();
  private readonly actionRequests$ = new Subject<CommunityFeedCommentActionRequest>();
  private pendingCreateRequestId: string | null = null;
  private expectedRealtimeCommentCount: number | null = null;
  private readonly pendingActionRequestIds = new Map<string, string>();
  private highlightTimer: ReturnType<typeof setTimeout> | null = null;

  readonly communityId = input.required<string>();
  readonly postId = input.required<string>();
  readonly canComment = input(false);
  readonly postAuthorLabel = input('Participante');
  readonly postTextPreview = input('Publicação');
  readonly replyToPostRequested = input(false);
  readonly replyRequestVersion = input(0);
  readonly commentCountChanged = output<number>();
  readonly closeRequested = output<void>();
  readonly postReplyCleared = output<void>();
  readonly feedPostCreated = output<string>();
  readonly actionCommentId = signal<string | null>(null);
  readonly actionMode = signal<CommunityFeedCommentAction | null>(null);
  readonly recentCommentId = signal<string | null>(null);
  readonly highlightedCommentId = signal<string | null>(null);
  readonly replyTarget = signal<CommunityFeedCommentItem | null>(null);
  readonly composerTextarea = viewChild<ElementRef<HTMLTextAreaElement>>('composerTextarea');
  readonly now = toSignal(this.timeTicker.now$, { initialValue: Date.now() });
  readonly commentControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(500)],
  });
  readonly commentForm = new FormGroup({
    text: this.commentControl,
  });
  readonly removalReason = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(3), Validators.maxLength(240)],
  });

  private readonly focusPostReplyEffect = effect(() => {
    const requested = this.replyToPostRequested();
    const requestVersion = this.replyRequestVersion();
    if (!requested || requestVersion < 1) return;

    queueMicrotask(() => this.focusComposer());
  });

  readonly state$ = combineLatest([
    toObservable(this.communityId),
    toObservable(this.postId),
  ]).pipe(
    map(([communityId, postId]) => [communityId.trim(), postId.trim()] as const),
    filter(([communityId, postId]) => !!communityId && !!postId),
    distinctUntilChanged(
      ([previousCommunity, previousPost], [currentCommunity, currentPost]) =>
        previousCommunity === currentCommunity && previousPost === currentPost
    ),
    switchMap(([communityId, postId]) => {
      const realtimeRefreshRequests$: Observable<CommentLoadRequest> =
        typeof this.repository.watchCommentCount$ === 'function'
          ? this.repository.watchCommentCount$(communityId, postId).pipe(
              skip(1),
              tap((commentCount) => this.commentCountChanged.emit(commentCount)),
              filter((commentCount) => !this.consumeLocallyConfirmedCount(commentCount)),
              map((): CommentLoadRequest => ({
                cursor: null,
                append: false,
                preserve: true,
              })),
              catchError((error: unknown) => {
                this.reportRealtimeError(error);
                return EMPTY;
              })
            )
          : EMPTY;

      return merge(
        this.loadRequests$,
        realtimeRefreshRequests$
      ).pipe(
        startWith<CommentLoadRequest>({
          cursor: null,
          append: false,
          preserve: false,
        }),
        concatMap((request) => this.repository.getPage$({
          communityId,
          postId,
          limit: 12,
          cursor: request.cursor,
        }).pipe(
          map((page): CommentLoadEvent => ({ type: 'success', request, page })),
          startWith<CommentLoadEvent>({ type: 'loading', request }),
          catchError((error: unknown) => {
            this.reportError(error, 'load');
            return of<CommentLoadEvent>({ type: 'error', request });
          })
        )),
        scan(reduceState, INITIAL_STATE)
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly createState$ = this.createRequests$.pipe(
    exhaustMap((command) => {
      const write$ = command.kind === 'feed_reply'
        ? this.feedRepository.createPost$(command.request).pipe(
            map((response): ConversationCreateResult => ({
              kind: 'feed_reply',
              request: command.request,
              response,
            }))
          )
        : this.repository.createComment$(command.request).pipe(
            map((response): ConversationCreateResult => ({
              kind: 'legacy_comment',
              request: command.request,
              response,
            }))
          );

      return write$.pipe(
        tap((result) => this.handleCreateSuccess(result)),
        map((): CommentWriteState => 'idle'),
        startWith<CommentWriteState>('loading'),
        catchError((error: unknown) => {
          this.reportError(error, 'create');
          return of<CommentWriteState>('error');
        })
      );
    }),
    startWith<CommentWriteState>('idle'),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly actionState$ = this.actionRequests$.pipe(
    exhaustMap((request) => this.repository.moderateComment$(request).pipe(
      tap((response) => {
        this.pendingActionRequestIds.delete(
          this.actionKey(response.commentId, response.action)
        );
        this.cancelAction();
        this.expectedRealtimeCommentCount = response.commentCount;
        this.commentCountChanged.emit(response.commentCount);
        this.loadRequests$.next({
          cursor: null,
          append: false,
          preserve: true,
        });
        this.notification.showSuccess(
          response.action === 'delete_own'
            ? 'Mensagem excluída.'
            : 'Mensagem removida da conversa.'
        );
      }),
      map((): CommentActionState => ({
        status: 'idle',
        commentId: null,
        action: null,
      })),
      startWith<CommentActionState>({
        status: 'loading',
        commentId: request.commentId,
        action: request.action,
      }),
      catchError((error: unknown) => {
        this.reportError(error, 'moderate');
        return of<CommentActionState>({
          status: 'error',
          commentId: request.commentId,
          action: request.action,
        });
      })
    )),
    startWith<CommentActionState>({
      status: 'idle',
      commentId: null,
      action: null,
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  ngOnDestroy(): void {
    if (this.highlightTimer) clearTimeout(this.highlightTimer);
  }

  submitCommentOnEnter(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.isComposing || keyboardEvent.shiftKey) return;
    event.preventDefault();
    if (keyboardEvent.repeat) return;
    this.submitComment();
  }

  submitComment(): void {
    const text = this.commentControl.value.replace(/\s+/g, ' ').trim();
    if (!this.canComment() || !text || this.commentForm.invalid) {
      this.commentForm.markAllAsTouched();
      this.notification.showWarning('Escreva uma mensagem válida.');
      return;
    }

    this.pendingCreateRequestId ??= this.createRequestId();
    const replyTarget = this.replyTarget();
    if (replyTarget) {
      this.createRequests$.next({
        kind: 'legacy_comment',
        request: {
          requestId: this.pendingCreateRequestId,
          communityId: this.communityId().trim(),
          postId: this.postId().trim(),
          text,
          replyToCommentId: replyTarget.commentId,
        },
      });
      return;
    }

    this.createRequests$.next({
      kind: 'feed_reply',
      request: {
        requestId: this.pendingCreateRequestId,
        communityId: this.communityId().trim(),
        text,
        audience: 'members_only',
        imageUploadPath: null,
        replyToPostId: this.postId().trim(),
      },
    });
  }

  startReply(item: CommunityFeedCommentItem): void {
    if (!this.canComment()) return;
    if (this.replyTarget()?.commentId !== item.commentId) {
      this.pendingCreateRequestId = null;
    }
    if (this.replyToPostRequested()) this.postReplyCleared.emit();
    this.replyTarget.set(item);
    queueMicrotask(() => this.focusComposer());
  }

  cancelReply(): void {
    this.pendingCreateRequestId = null;
    this.replyTarget.set(null);
  }

  cancelPostReply(): void {
    this.pendingCreateRequestId = null;
    this.postReplyCleared.emit();
  }

  scrollToReferencedComment(commentId: string): void {
    const element = document.getElementById(this.commentDomId(commentId));
    if (!element) {
      this.notification.showWarning('A mensagem original não está carregada nesta parte da conversa.');
      return;
    }
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    this.highlightedCommentId.set(commentId);
    if (this.highlightTimer) clearTimeout(this.highlightTimer);
    this.highlightTimer = setTimeout(() => {
      if (this.highlightedCommentId() === commentId) {
        this.highlightedCommentId.set(null);
      }
      this.highlightTimer = null;
    }, 1_800);
  }

  commentDomId(commentId: string): string {
    return `community-conversation-message-${commentId}`;
  }

  requestClose(): void {
    this.closeRequested.emit();
  }

  requestAction(
    item: CommunityFeedCommentItem,
    action: CommunityFeedCommentAction
  ): void {
    const allowed = action === 'delete_own'
      ? item.capabilities.canDeleteOwn
      : item.capabilities.canModerate;
    if (!allowed) return;
    this.actionCommentId.set(item.commentId);
    this.actionMode.set(action);
    this.removalReason.reset('');
  }

  confirmAction(item: CommunityFeedCommentItem): void {
    const action = this.actionMode();
    if (!action || this.actionCommentId() !== item.commentId) return;
    const reason = action === 'remove' ? this.removalReason.value.trim() : null;
    if (action === 'remove' && this.removalReason.invalid) {
      this.removalReason.markAsTouched();
      this.notification.showWarning('Informe o motivo da remoção.');
      return;
    }
    const key = this.actionKey(item.commentId, action);
    const requestId = this.pendingActionRequestIds.get(key) ?? this.createRequestId();
    this.pendingActionRequestIds.set(key, requestId);
    this.actionRequests$.next({
      requestId,
      communityId: this.communityId().trim(),
      postId: this.postId().trim(),
      commentId: item.commentId,
      action,
      reason,
    });
  }

  cancelAction(): void {
    const commentId = this.actionCommentId();
    const action = this.actionMode();
    if (commentId && action) {
      this.pendingActionRequestIds.delete(this.actionKey(commentId, action));
    }
    this.actionCommentId.set(null);
    this.actionMode.set(null);
    this.removalReason.reset('');
  }

  loadMore(cursor: string | null): void {
    if (cursor) {
      this.loadRequests$.next({
        cursor,
        append: true,
        preserve: true,
      });
    }
  }

  retry(): void {
    this.loadRequests$.next({
      cursor: null,
      append: false,
      preserve: false,
    });
  }

  createdIso(createdAt: number): string {
    return formatCommunityFeedIso(createdAt);
  }

  createdLabel(createdAt: number): string {
    return formatCommunityFeedTime(createdAt, this.now());
  }

  private handleCreateSuccess(result: ConversationCreateResult): void {
    this.pendingCreateRequestId = null;
    this.commentForm.reset({ text: '' });
    this.replyTarget.set(null);

    if (result.kind === 'feed_reply') {
      this.feedPostCreated.emit(result.response.postId);
      this.postReplyCleared.emit();
      this.closeRequested.emit();
      this.notification.showSuccess(
        result.response.deduplicated
          ? 'Resposta confirmada.'
          : 'Resposta publicada no Mural.'
      );
      return;
    }

    this.expectedRealtimeCommentCount = result.response.commentCount;
    this.recentCommentId.set(result.response.commentId);
    this.commentCountChanged.emit(result.response.commentCount);
    this.loadRequests$.next({
      cursor: null,
      append: false,
      preserve: true,
    });
    this.notification.showSuccess(
      result.response.deduplicated
        ? 'Mensagem confirmada.'
        : result.request.replyToCommentId
          ? 'Resposta enviada.'
          : 'Mensagem publicada.'
    );
  }

  private focusComposer(): void {
    this.composerTextarea()?.nativeElement.focus();
  }

  private consumeLocallyConfirmedCount(commentCount: number): boolean {
    const expected = this.expectedRealtimeCommentCount;
    if (expected === null) return false;
    this.expectedRealtimeCommentCount = null;
    return commentCount === expected;
  }

  private actionKey(commentId: string, action: CommunityFeedCommentAction): string {
    return `${action}:${commentId}`;
  }

  private createRequestId(): string {
    try {
      const uuid = globalThis.crypto?.randomUUID?.();
      if (uuid) return uuid;
    } catch {
      // O fallback mantém idempotência durante a sessão.
    }
    return `comment-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 14)}`;
  }

  private reportRealtimeError(error: unknown): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation: 'watchCommentCount',
      fallbackMessage: 'Atualizações da conversa em tempo real estão indisponíveis.',
      notification: 'none',
      metadata: {
        scope: 'CommunityFeedCommentsComponent',
        communityId: this.communityId(),
        postId: this.postId(),
      },
    });
  }

  private reportError(
    error: unknown,
    operation: 'load' | 'create' | 'moderate'
  ): void {
    const fallbackMessage = operation === 'load'
      ? 'Não foi possível carregar a conversa.'
      : operation === 'create'
        ? 'Não foi possível enviar a mensagem agora.'
        : 'Não foi possível atualizar a mensagem agora.';

    this.applicationError.report(error, {
      feature: 'community',
      operation: operation === 'load'
        ? 'loadConversation'
        : operation === 'create'
          ? 'createConversationMessage'
          : 'moderateConversationMessage',
      fallbackMessage,
      codeMessages: operation === 'create'
        ? COMMUNITY_FEED_CONVERSATION_CREATE_CODE_MESSAGES
        : operation === 'moderate'
          ? COMMUNITY_FEED_CONVERSATION_ACTION_CODE_MESSAGES
          : undefined,
      reasonMessages: COMMUNITY_FEED_CONVERSATION_REASON_MESSAGES,
      metadata: {
        scope: 'CommunityFeedCommentsComponent',
        communityId: this.communityId(),
        postId: this.postId(),
      },
    });
  }
}
