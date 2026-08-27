// src/app/community/topics/community-topics.component.ts
import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
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
import type { CommunityPreviewViewerRole } from '../data-access/community-preview.model';
import {
  CommunityTopicCreateRequest,
  CommunityTopicDetailResponse,
  CommunityTopicModerationResponse,
  CommunityTopicReplyCreateRequest,
  CommunityTopicStatus,
} from '../data-access/community-topic.model';
import { CommunityTopicRepository } from '../data-access/community-topic.repository';
import { CommunityTopicModerationControlsComponent } from './community-topic-moderation-controls.component';
import { createCommunityTopicRequestId } from './community-topic-request-id';
import {
  CommunityTopicRepliesLoadEvent,
  CommunityTopicsLoadEvent,
  CommunityTopicsLoadRequest,
  INITIAL_COMMUNITY_TOPIC_REPLIES_STATE,
  INITIAL_COMMUNITY_TOPICS_STATE,
  reduceCommunityTopicRepliesState,
  reduceCommunityTopicsState,
} from './community-topics-state.model';

type CommunityTopicDetailState =
  | { readonly status: 'loading'; readonly detail: null }
  | { readonly status: 'ready'; readonly detail: CommunityTopicDetailResponse }
  | { readonly status: 'error'; readonly detail: null };

type CommunityTopicWriteState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error' };

type CommunityTopicWriteKind = 'topic' | 'reply';

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

@Component({
  selector: 'app-community-topics',
  standalone: true,
  imports: [
    AsyncPipe,
    ReactiveFormsModule,
    ImageFallbackDirective,
    CommunityTopicModerationControlsComponent,
  ],
  templateUrl: './community-topics.component.html',
  styleUrl: './community-topics.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityTopicsComponent {
  private readonly repository = inject(CommunityTopicRepository);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly topicLoadRequests$ = new Subject<CommunityTopicsLoadRequest>();
  private readonly replyLoadRequests$ = new Subject<CommunityTopicsLoadRequest>();
  private readonly detailRefresh$ = new Subject<void>();
  private readonly topicCreateRequests$ = new Subject<CommunityTopicCreateRequest>();
  private readonly replyCreateRequests$ = new Subject<CommunityTopicReplyCreateRequest>();
  private pendingTopicRequest: CommunityTopicCreateRequest | null = null;
  private pendingReplyRequest: CommunityTopicReplyCreateRequest | null = null;

  readonly communityId = input<string>('');
  readonly canInteract = input<boolean>(false);
  readonly viewerRole = input<CommunityPreviewViewerRole | null>(null);
  readonly selectedTopicId = signal<string | null>(null);
  readonly composerOpen = signal(false);

  readonly topicForm = new FormGroup({
    title: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.minLength(3),
        Validators.maxLength(120),
      ],
    }),
    body: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(5_000)],
    }),
  });

  readonly replyForm = new FormGroup({
    body: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(5_000)],
    }),
  });

  private readonly communityId$ = toObservable(this.communityId).pipe(
    map((communityId) => communityId.trim()),
    filter((communityId) => communityId.length > 0),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly selectedTopicId$ = toObservable(this.selectedTopicId).pipe(
    filter((topicId): topicId is string => Boolean(topicId)),
    distinctUntilChanged()
  );

  readonly state$ = this.communityId$.pipe(
    switchMap((communityId) =>
      this.topicLoadRequests$.pipe(
        startWith<CommunityTopicsLoadRequest>({ cursor: null, append: false }),
        exhaustMap((request) =>
          this.repository
            .getPage$({ communityId, limit: 12, cursor: request.cursor })
            .pipe(
              map(
                (page): CommunityTopicsLoadEvent => ({
                  type: 'success',
                  request,
                  page,
                })
              ),
              startWith<CommunityTopicsLoadEvent>({ type: 'loading', request }),
              catchError((error: unknown) => {
                this.reportError(
                  error,
                  'loadTopics',
                  'Não foi possível carregar as discussões da Comunidade agora.'
                );
                return of<CommunityTopicsLoadEvent>({ type: 'error', request });
              })
            )
        ),
        scan(reduceCommunityTopicsState, INITIAL_COMMUNITY_TOPICS_STATE)
      )
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly detailState$ = combineLatest([
    this.communityId$,
    this.selectedTopicId$,
  ]).pipe(
    switchMap(([communityId, topicId]) =>
      this.detailRefresh$.pipe(
        startWith(undefined),
        switchMap(() =>
          this.repository.getDetail$({ communityId, topicId }).pipe(
            map(
              (detail): CommunityTopicDetailState => ({
                status: 'ready',
                detail,
              })
            ),
            startWith<CommunityTopicDetailState>({
              status: 'loading',
              detail: null,
            }),
            catchError((error: unknown) => {
              this.reportError(
                error,
                'loadDetail',
                'Não foi possível abrir esta discussão agora.'
              );
              return of<CommunityTopicDetailState>({
                status: 'error',
                detail: null,
              });
            })
          )
        )
      )
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly repliesState$ = combineLatest([
    this.communityId$,
    this.selectedTopicId$,
  ]).pipe(
    switchMap(([communityId, topicId]) =>
      this.replyLoadRequests$.pipe(
        startWith<CommunityTopicsLoadRequest>({ cursor: null, append: false }),
        exhaustMap((request) =>
          this.repository
            .getRepliesPage$({
              communityId,
              topicId,
              limit: 20,
              cursor: request.cursor,
            })
            .pipe(
              map(
                (page): CommunityTopicRepliesLoadEvent => ({
                  type: 'success',
                  request,
                  page,
                })
              ),
              startWith<CommunityTopicRepliesLoadEvent>({
                type: 'loading',
                request,
              }),
              catchError((error: unknown) => {
                this.reportError(
                  error,
                  'loadReplies',
                  'Não foi possível carregar as respostas desta discussão agora.'
                );
                return of<CommunityTopicRepliesLoadEvent>({
                  type: 'error',
                  request,
                });
              })
            )
        ),
        scan(
          reduceCommunityTopicRepliesState,
          INITIAL_COMMUNITY_TOPIC_REPLIES_STATE
        )
      )
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly topicCreateState$ = this.topicCreateRequests$.pipe(
    exhaustMap((request) =>
      this.repository.createTopic$(request).pipe(
        tap((result) => {
          this.pendingTopicRequest = null;
          this.topicForm.reset({ title: '', body: '' });
          this.composerOpen.set(false);
          this.topicLoadRequests$.next({ cursor: null, append: false });
          this.selectTopic(result.topicId);
          this.showSuccess(
            result.deduplicated ? 'Discussão confirmada.' : 'Discussão publicada.'
          );
        }),
        map((): CommunityTopicWriteState => ({ status: 'idle' })),
        startWith<CommunityTopicWriteState>({ status: 'loading' }),
        catchError((error: unknown) => {
          this.reportError(
            error,
            'createTopic',
            this.writeErrorMessage(error, 'topic')
          );
          return of<CommunityTopicWriteState>({ status: 'error' });
        })
      )
    ),
    startWith<CommunityTopicWriteState>({ status: 'idle' }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly replyCreateState$ = this.replyCreateRequests$.pipe(
    exhaustMap((request) =>
      this.repository.createReply$(request).pipe(
        tap((result) => {
          this.pendingReplyRequest = null;
          this.replyForm.reset({ body: '' });
          this.detailRefresh$.next();
          this.replyLoadRequests$.next({ cursor: null, append: false });
          this.topicLoadRequests$.next({ cursor: null, append: false });
          this.showSuccess(
            result.deduplicated ? 'Resposta confirmada.' : 'Resposta publicada.'
          );
        }),
        map((): CommunityTopicWriteState => ({ status: 'idle' })),
        startWith<CommunityTopicWriteState>({ status: 'loading' }),
        catchError((error: unknown) => {
          this.reportError(
            error,
            'createReply',
            this.writeErrorMessage(error, 'reply')
          );
          return of<CommunityTopicWriteState>({ status: 'error' });
        })
      )
    ),
    startWith<CommunityTopicWriteState>({ status: 'idle' }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  toggleComposer(): void {
    if (!this.canInteract()) return;
    this.composerOpen.update((open) => !open);
  }

  submitTopic(): void {
    if (!this.canInteract()) return;

    const title = this.topicForm.controls.title.value.trim();
    const body = this.topicForm.controls.body.value.trim();

    if (this.topicForm.invalid || title.length < 3 || body.length < 1) {
      this.topicForm.markAllAsTouched();
      return;
    }

    const existing = this.pendingTopicRequest;
    const request: CommunityTopicCreateRequest =
      existing
      && existing.communityId === this.communityId().trim()
      && existing.title === title
      && existing.body === body
        ? existing
        : {
            requestId: createCommunityTopicRequestId('topic'),
            communityId: this.communityId().trim(),
            title,
            body,
            // Compatibilidade de transporte. O backend deriva a audiência
            // exclusivamente da visibilidade configurada para a Comunidade.
            audience: 'members_only',
          };

    this.pendingTopicRequest = request;
    this.topicCreateRequests$.next(request);
  }

  submitReply(canReply: boolean): void {
    const topicId = this.selectedTopicId();
    const body = this.replyForm.controls.body.value.trim();

    if (!topicId || !canReply || this.replyForm.invalid || body.length < 1) {
      this.replyForm.markAllAsTouched();
      return;
    }

    const existing = this.pendingReplyRequest;
    const request: CommunityTopicReplyCreateRequest =
      existing
      && existing.communityId === this.communityId().trim()
      && existing.topicId === topicId
      && existing.body === body
        ? existing
        : {
            requestId: createCommunityTopicRequestId('reply'),
            communityId: this.communityId().trim(),
            topicId,
            body,
          };

    this.pendingReplyRequest = request;
    this.replyCreateRequests$.next(request);
  }

  topicModerated(result: CommunityTopicModerationResponse): void {
    this.topicLoadRequests$.next({ cursor: null, append: false });

    if (result.status === 'archived' || result.moderationState === 'removed') {
      this.closeTopic();
      return;
    }

    if (result.status === 'locked') {
      this.pendingReplyRequest = null;
      this.replyForm.reset({ body: '' });
    }

    this.detailRefresh$.next();
  }

  topicTitleInvalid(): boolean {
    const control = this.topicForm.controls.title;
    return control.touched && (control.invalid || control.value.trim().length < 3);
  }

  topicBodyInvalid(): boolean {
    const control = this.topicForm.controls.body;
    return control.touched && (control.invalid || control.value.trim().length < 1);
  }

  replyBodyInvalid(): boolean {
    const control = this.replyForm.controls.body;
    return control.touched && (control.invalid || control.value.trim().length < 1);
  }

  selectTopic(topicId: string): void {
    if (this.selectedTopicId() !== topicId) {
      this.pendingReplyRequest = null;
      this.replyForm.reset({ body: '' });
    }
    this.selectedTopicId.set(topicId);
  }

  closeTopic(): void {
    this.pendingReplyRequest = null;
    this.replyForm.reset({ body: '' });
    this.selectedTopicId.set(null);
  }

  loadMoreTopics(cursor: string | null): void {
    if (cursor) this.topicLoadRequests$.next({ cursor, append: true });
  }

  retryTopics(): void {
    this.topicLoadRequests$.next({ cursor: null, append: false });
  }

  retryDetail(): void {
    this.detailRefresh$.next();
  }

  loadMoreReplies(cursor: string | null): void {
    if (cursor) this.replyLoadRequests$.next({ cursor, append: true });
  }

  retryReplies(): void {
    this.replyLoadRequests$.next({ cursor: null, append: false });
  }

  statusLabel(status: CommunityTopicStatus): string {
    return status === 'locked' ? 'Encerrado' : 'Aberto';
  }

  dateTimeIso(timestamp: number): string {
    return new Date(timestamp).toISOString();
  }

  dateTimeLabel(timestamp: number): string {
    return DATE_TIME_FORMATTER.format(new Date(timestamp));
  }

  private writeErrorMessage(
    error: unknown,
    kind: CommunityTopicWriteKind
  ): string {
    const rawCode = String((error as { code?: unknown } | null)?.code ?? '');
    const code = rawCode.replace(/^functions\//, '');

    if (code === 'resource-exhausted') {
      return 'Você atingiu o limite temporário de interações em Discussões. Tente novamente mais tarde.';
    }

    if (code === 'permission-denied') {
      return kind === 'topic'
        ? 'Sua participação atual não permite criar discussões.'
        : 'Sua participação atual não permite responder nesta discussão.';
    }

    if (code === 'failed-precondition') {
      return 'Sua conta ou esta discussão precisa ser atualizada antes desta interação.';
    }

    return kind === 'topic'
      ? 'Não foi possível publicar a discussão agora.'
      : 'Não foi possível publicar a resposta agora.';
  }

  private showSuccess(message: string): void {
    try {
      this.errorNotifier.showSuccess(message);
    } catch {
      // Feedback secundário não invalida uma escrita já confirmada pelo backend.
    }
  }

  private reportError(error: unknown, op: string, userMessage: string): void {
    try {
      this.errorNotifier.showError(userMessage);
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
        scope: 'CommunityTopicsComponent',
        op,
        communityId: this.communityId(),
        topicId: this.selectedTopicId(),
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // Falha secundária não interrompe o estado visual.
    }
  }
}