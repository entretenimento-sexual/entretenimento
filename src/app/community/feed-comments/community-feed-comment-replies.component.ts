// -----------------------------------------------------------------------------
// COMMUNITY FEED COMMENT REPLIES
// -----------------------------------------------------------------------------
// Thread raso de respostas de um comentário. O componente só consulta a rede
// quando o usuário expande a thread ou escolhe responder, evitando N+1 requests
// para comentários que permanecem recolhidos.
// -----------------------------------------------------------------------------

import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
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
  Subject,
  catchError,
  combineLatest,
  concatMap,
  distinctUntilChanged,
  exhaustMap,
  filter,
  map,
  of,
  scan,
  shareReplay,
  startWith,
  switchMap,
  tap,
} from 'rxjs';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ReportContentButtonComponent } from 'src/app/shared/components-globais/moderation-report/report-content-button/report-content-button.component';
import { ImageFallbackDirective } from 'src/app/shared/directives/image-fallback.directive';
import {
  CommunityFeedCommentAction,
  CommunityFeedCommentReplyActionRequest,
  CommunityFeedCommentReplyCreateRequest,
  CommunityFeedCommentReplyItem,
  CommunityFeedCommentReplyPage,
} from '../data-access/community-feed-comment.model';
import { CommunityFeedCommentRepository } from '../data-access/community-feed-comment.repository';
import { CommunityFeedTimeTickerService } from '../feed/community-feed-time-ticker.service';
import {
  formatCommunityFeedIso,
  formatCommunityFeedTime,
} from '../feed/community-feed-time.util';

interface ReplyLoadRequest {
  cursor: string | null;
  append: boolean;
  preserve?: boolean;
}

type ReplyLoadState =
  | { status: 'collapsed'; items: readonly CommunityFeedCommentReplyItem[]; nextCursor: null; loadingMore: false }
  | { status: 'loading'; items: readonly CommunityFeedCommentReplyItem[]; nextCursor: null; loadingMore: false }
  | { status: 'error'; items: readonly CommunityFeedCommentReplyItem[]; nextCursor: null; loadingMore: false }
  | { status: 'empty'; items: readonly CommunityFeedCommentReplyItem[]; nextCursor: null; loadingMore: false }
  | { status: 'ready'; items: readonly CommunityFeedCommentReplyItem[]; nextCursor: string | null; loadingMore: boolean };

type ReplyLoadEvent =
  | { type: 'loading'; request: ReplyLoadRequest }
  | { type: 'success'; request: ReplyLoadRequest; page: CommunityFeedCommentReplyPage }
  | { type: 'error'; request: ReplyLoadRequest };

type ReplyWriteState = 'idle' | 'loading' | 'error';

interface ReplyActionState {
  status: 'idle' | 'loading' | 'error';
  replyId: string | null;
  action: CommunityFeedCommentAction | null;
}

const COLLAPSED_STATE: ReplyLoadState = {
  status: 'collapsed',
  items: [],
  nextCursor: null,
  loadingMore: false,
};

const INITIAL_LOADING_STATE: ReplyLoadState = {
  status: 'loading',
  items: [],
  nextCursor: null,
  loadingMore: false,
};

function reduceReplyState(
  state: ReplyLoadState,
  event: ReplyLoadEvent
): ReplyLoadState {
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
      : INITIAL_LOADING_STATE;
  }

  if (event.type === 'error') {
    return preserveCurrent
      ? { ...state, status: 'ready', loadingMore: false }
      : { status: 'error', items: [], nextCursor: null, loadingMore: false };
  }

  const items = event.request.append
    ? [
        ...state.items,
        ...event.page.items.filter(
          (candidate) => !state.items.some(
            (current) => current.replyId === candidate.replyId
          )
        ),
      ]
    : [...event.page.items];

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
  selector: 'app-community-feed-comment-replies',
  standalone: true,
  imports: [
    AsyncPipe,
    ImageFallbackDirective,
    ReactiveFormsModule,
    ReportContentButtonComponent,
  ],
  templateUrl: './community-feed-comment-replies.component.html',
  styleUrl: './community-feed-comment-replies.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityFeedCommentRepliesComponent {
  private readonly repository = inject(CommunityFeedCommentRepository);
  private readonly notification = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly timeTicker = inject(CommunityFeedTimeTickerService);
  private readonly loadRequests$ = new Subject<ReplyLoadRequest>();
  private readonly createRequests$ = new Subject<CommunityFeedCommentReplyCreateRequest>();
  private readonly actionRequests$ = new Subject<CommunityFeedCommentReplyActionRequest>();
  private pendingCreateRequestId: string | null = null;
  private readonly pendingActionRequestIds = new Map<string, string>();

  readonly communityId = input.required<string>();
  readonly postId = input.required<string>();
  readonly commentId = input.required<string>();
  readonly parentAuthorLabel = input('participante');
  readonly initialReplyCount = input(0);
  readonly canReply = input(false);

  readonly expanded = signal(false);
  readonly composerOpen = signal(false);
  readonly localReplyCount = signal<number | null>(null);
  readonly recentReplyId = signal<string | null>(null);
  readonly actionReplyId = signal<string | null>(null);
  readonly actionMode = signal<CommunityFeedCommentAction | null>(null);
  readonly now = toSignal(this.timeTicker.now$, { initialValue: Date.now() });
  readonly displayReplyCount = computed(() => {
    const local = this.localReplyCount();
    const initial = Math.max(0, Math.trunc(Number(this.initialReplyCount()) || 0));
    return local === null ? initial : Math.max(0, local);
  });

  readonly replyControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(500)],
  });
  readonly replyForm = new FormGroup({ text: this.replyControl });
  readonly removalReason = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(3), Validators.maxLength(240)],
  });

  readonly state$ = combineLatest([
    toObservable(this.communityId),
    toObservable(this.postId),
    toObservable(this.commentId),
    toObservable(this.expanded),
  ]).pipe(
    map(([communityId, postId, commentId, expanded]) => ({
      communityId: communityId.trim(),
      postId: postId.trim(),
      commentId: commentId.trim(),
      expanded,
    })),
    filter(({ communityId, postId, commentId }) =>
      !!communityId && !!postId && !!commentId
    ),
    distinctUntilChanged((previous, current) =>
      previous.communityId === current.communityId
      && previous.postId === current.postId
      && previous.commentId === current.commentId
      && previous.expanded === current.expanded
    ),
    switchMap(({ communityId, postId, commentId, expanded }) => {
      if (!expanded) return of(COLLAPSED_STATE);

      return this.loadRequests$.pipe(
        startWith<ReplyLoadRequest>({
          cursor: null,
          append: false,
          preserve: false,
        }),
        concatMap((loadRequest) => this.repository.getRepliesPage$({
          communityId,
          postId,
          commentId,
          limit: 8,
          cursor: loadRequest.cursor,
        }).pipe(
          map((page): ReplyLoadEvent => ({
            type: 'success',
            request: loadRequest,
            page,
          })),
          startWith<ReplyLoadEvent>({ type: 'loading', request: loadRequest }),
          catchError((error: unknown) => {
            this.reportError(error, 'load');
            return of<ReplyLoadEvent>({ type: 'error', request: loadRequest });
          })
        )),
        scan(reduceReplyState, INITIAL_LOADING_STATE)
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly createState$ = this.createRequests$.pipe(
    exhaustMap((request) => this.repository.createReply$(request).pipe(
      tap((response) => {
        this.pendingCreateRequestId = null;
        this.localReplyCount.set(response.replyCount);
        this.recentReplyId.set(response.replyId);
        this.replyForm.reset({ text: '' });
        this.composerOpen.set(false);
        this.expanded.set(true);
        this.loadRequests$.next({
          cursor: null,
          append: false,
          preserve: true,
        });
        this.notification.showSuccess(
          response.deduplicated ? 'Resposta confirmada.' : 'Resposta publicada.'
        );
      }),
      map((): ReplyWriteState => 'idle'),
      startWith<ReplyWriteState>('loading'),
      catchError((error: unknown) => {
        this.reportError(error, 'create');
        return of<ReplyWriteState>('error');
      })
    )),
    startWith<ReplyWriteState>('idle'),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly actionState$ = this.actionRequests$.pipe(
    exhaustMap((request) => this.repository.moderateReply$(request).pipe(
      tap((response) => {
        this.pendingActionRequestIds.delete(
          this.actionKey(response.replyId, response.action)
        );
        this.cancelAction();
        this.localReplyCount.set(response.replyCount);
        this.loadRequests$.next({
          cursor: null,
          append: false,
          preserve: true,
        });
        this.notification.showSuccess(
          response.action === 'delete_own'
            ? 'Resposta excluída.'
            : 'Resposta removida do Mural.'
        );
      }),
      map((): ReplyActionState => ({
        status: 'idle',
        replyId: null,
        action: null,
      })),
      startWith<ReplyActionState>({
        status: 'loading',
        replyId: request.replyId,
        action: request.action,
      }),
      catchError((error: unknown) => {
        this.reportError(error, 'moderate');
        return of<ReplyActionState>({
          status: 'error',
          replyId: request.replyId,
          action: request.action,
        });
      })
    )),
    startWith<ReplyActionState>({
      status: 'idle',
      replyId: null,
      action: null,
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  toggleReplies(): void {
    if (this.displayReplyCount() < 1 && !this.expanded()) return;
    this.expanded.update((expanded) => !expanded);
  }

  openComposer(): void {
    if (!this.canReply()) {
      this.notification.showWarning(
        'Participe da Comunidade para responder.'
      );
      return;
    }
    this.expanded.set(true);
    this.composerOpen.set(true);
  }

  cancelComposer(): void {
    this.composerOpen.set(false);
  }

  submitReplyOnEnter(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.isComposing || keyboardEvent.shiftKey) {
      return;
    }

    event.preventDefault();
    if (keyboardEvent.repeat) {
      return;
    }

    this.submitReply();
  }

  submitReply(): void {
    const text = this.replyControl.value.replace(/\s+/g, ' ').trim();
    if (!this.canReply() || !text || this.replyForm.invalid) {
      this.replyForm.markAllAsTouched();
      this.notification.showWarning('Escreva uma resposta válida.');
      return;
    }

    this.pendingCreateRequestId ??= this.createRequestId();
    this.createRequests$.next({
      requestId: this.pendingCreateRequestId,
      communityId: this.communityId().trim(),
      postId: this.postId().trim(),
      commentId: this.commentId().trim(),
      text,
    });
  }

  requestAction(
    reply: CommunityFeedCommentReplyItem,
    action: CommunityFeedCommentAction
  ): void {
    const allowed = action === 'delete_own'
      ? reply.capabilities.canDeleteOwn
      : reply.capabilities.canModerate;
    if (!allowed) return;

    this.actionReplyId.set(reply.replyId);
    this.actionMode.set(action);
    this.removalReason.reset('');
  }

  confirmAction(reply: CommunityFeedCommentReplyItem): void {
    const action = this.actionMode();
    if (!action || this.actionReplyId() !== reply.replyId) return;

    const reason = action === 'remove' ? this.removalReason.value.trim() : null;
    if (action === 'remove' && this.removalReason.invalid) {
      this.removalReason.markAsTouched();
      this.notification.showWarning('Informe o motivo da remoção.');
      return;
    }

    const key = this.actionKey(reply.replyId, action);
    const requestId = this.pendingActionRequestIds.get(key) ?? this.createRequestId();
    this.pendingActionRequestIds.set(key, requestId);
    this.actionRequests$.next({
      requestId,
      communityId: this.communityId().trim(),
      postId: this.postId().trim(),
      commentId: this.commentId().trim(),
      replyId: reply.replyId,
      action,
      reason,
    });
  }

  cancelAction(): void {
    const replyId = this.actionReplyId();
    const action = this.actionMode();
    if (replyId && action) {
      this.pendingActionRequestIds.delete(this.actionKey(replyId, action));
    }
    this.actionReplyId.set(null);
    this.actionMode.set(null);
    this.removalReason.reset('');
  }

  loadMore(cursor: string | null): void {
    if (!cursor) return;
    this.loadRequests$.next({
      cursor,
      append: true,
      preserve: true,
    });
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

  private actionKey(replyId: string, action: CommunityFeedCommentAction): string {
    return `${action}:${replyId}`;
  }

  private createRequestId(): string {
    try {
      const uuid = globalThis.crypto?.randomUUID?.();
      if (uuid) return uuid;
    } catch {
      // O fallback mantém idempotência durante a sessão.
    }
    return `reply-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 14)}`;
  }

  private reportError(
    error: unknown,
    operation: 'load' | 'create' | 'moderate'
  ): void {
    const code = String((error as { code?: unknown })?.code ?? '')
      .replace(/^functions\//, '');
    const message = operation === 'load'
      ? 'Não foi possível carregar as respostas.'
      : operation === 'create'
        ? code === 'resource-exhausted'
          ? 'Você respondeu muitas vezes em pouco tempo. Aguarde um instante.'
          : 'Não foi possível publicar a resposta agora.'
        : 'Não foi possível atualizar a resposta agora.';

    try {
      this.notification.showError(message);
    } catch {
      // O diagnóstico técnico abaixo permanece ativo.
    }

    try {
      const normalized = error instanceof Error ? error : new Error(String(error));
      const contextual = normalized as Error & {
        context?: unknown;
        skipUserNotification?: boolean;
      };
      contextual.context = {
        scope: 'CommunityFeedCommentRepliesComponent',
        operation,
        communityId: this.communityId(),
        postId: this.postId(),
        commentId: this.commentId(),
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // Falha de telemetria não bloqueia a thread.
    }
  }
}
