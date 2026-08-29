// src/app/community/feed/community-feed.component.ts
// -----------------------------------------------------------------------------
// COMMUNITY FEED
// -----------------------------------------------------------------------------
// Mural comunitário fluido. Texto e anexo compartilham o mesmo composer; nesta
// etapa a imagem é a única variante habilitada e a aba Fotos continua sendo
// apenas uma visão filtrada da mesma timeline.
// -----------------------------------------------------------------------------

import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Injector,
  OnDestroy,
  effect,
  inject,
  input,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import {
  EMPTY,
  Observable,
  catchError,
  combineLatest,
  concatMap,
  distinctUntilChanged,
  exhaustMap,
  filter,
  finalize,
  map,
  merge,
  of,
  scan,
  shareReplay,
  startWith,
  Subject,
  switchMap,
  take,
  tap,
  throwError,
  timer,
} from 'rxjs';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { StorageService } from 'src/app/core/services/image-handling/storage.service';
import {
  GeolocationError,
  GeolocationErrorCode,
  GeolocationService,
} from 'src/app/core/services/geolocation/geolocation.service';
import { ImageFallbackDirective } from 'src/app/shared/directives/image-fallback.directive';
import { ReportContentButtonComponent } from 'src/app/shared/components-globais/moderation-report/report-content-button/report-content-button.component';
import {
  CommunityFeedItem,
  CommunityFeedPostAction,
  CommunityFeedPostActionRequest,
  CommunityFeedPostCreateRequest,
  CommunityFeedPostCreateResponse,
  CommunityFeedReactionRequest,
  CommunityFeedView,
} from '../data-access/community-feed.model';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';
import type { CommunityFeedRealtimeChange } from '../data-access/community-feed-realtime.model';
import { CommunityFeedCommentsComponent } from '../feed-comments/community-feed-comments.component';
import {
  CommunityPreviewSourceType,
  CommunityPreviewViewerRole,
} from '../data-access/community-preview.model';
import { CommunityCameraCaptureComponent } from './community-camera-capture.component';
import {
  CommunityComposerAttachment,
  createCommunityComposerLocationAttachment,
  validateCommunityComposerImage,
} from './community-composer-attachment.model';
import {
  CommunityFeedLoadEvent,
  CommunityFeedLoadRequest,
  INITIAL_COMMUNITY_FEED_STATE,
  reduceCommunityFeedState,
} from './community-feed-state.model';
import { CommunityFeedTimeTickerService } from './community-feed-time-ticker.service';
import {
  formatCommunityFeedIso,
  formatCommunityFeedTime,
} from './community-feed-time.util';

export {
  INITIAL_COMMUNITY_FEED_STATE,
  reduceCommunityFeedState,
} from './community-feed-state.model';

type CommunityFeedPostWriteState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' };

type CommunityFeedPostActionState =
  | { status: 'idle'; postId: null; action: null }
  | {
      status: 'loading' | 'error';
      postId: string;
      action: CommunityFeedPostAction;
    };

type CommunityFeedReactionState =
  | { status: 'idle'; postId: null }
  | { status: 'loading' | 'error'; postId: string };

interface CommunityFeedReactionOverride {
  reacted: boolean;
  reactionCount: number;
}

interface CommunityFeedReactionCommand {
  request: CommunityFeedReactionRequest;
  previous: CommunityFeedReactionOverride;
}

interface CommunityFeedComposerCommand {
  request: CommunityFeedPostCreateRequest;
  attachment: CommunityComposerAttachment | null;
}

interface CommunityFeedReferenceNavigationRequest {
  postId: string;
  sequence: number;
}

interface CommunityFeedMapCoordinates {
  latitude: number;
  longitude: number;
  cacheKey: string;
}

const MAX_UNSEEN_NEW_POSTS = 99;
const MAX_LOCATION_EMBED_URL_CACHE_ENTRIES = 64;

@Component({
  selector: 'app-community-feed',
  standalone: true,
  imports: [
    AsyncPipe,
    ImageFallbackDirective,
    ReactiveFormsModule,
    ReportContentButtonComponent,
    CommunityFeedCommentsComponent,
    CommunityCameraCaptureComponent,
  ],
  templateUrl: './community-feed.component.html',
  styleUrls: [
    './community-feed.component.css',
    './community-feed.interactions.css',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityFeedComponent implements OnDestroy {
  private readonly repository = inject(CommunityFeedRepository);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly timeTicker = inject(CommunityFeedTimeTickerService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly geolocation = inject(GeolocationService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly loadRequests$ = new Subject<CommunityFeedLoadRequest>();
  private readonly realtimeHydrationRequests$ = new Subject<string>();
  private readonly localFeedEvents$ = new Subject<CommunityFeedLoadEvent>();
  private readonly postCreateRequests$ =
    new Subject<CommunityFeedComposerCommand>();
  private readonly postActionRequests$ =
    new Subject<CommunityFeedPostActionRequest>();
  private readonly reactionRequests$ = new Subject<CommunityFeedReactionCommand>();
  private readonly referenceNavigationRequests$ =
    new Subject<CommunityFeedReferenceNavigationRequest>();
  private readonly postHighlightRequests$ = new Subject<string>();
  private readonly pendingReactionPostIds = new Set<string>();
  private readonly locationEmbedUrlCache = new Map<string, SafeResourceUrl>();
  private readonly postElements = viewChildren<ElementRef<HTMLElement>>('postElement');
  private readonly attachmentMenu = viewChild<ElementRef<HTMLDetailsElement>>('attachmentMenu');
  private readonly pendingOwnPostFollowId = signal<string | null>(null);
  private readonly unseenAnchorPostId = signal<string | null>(null);
  private pendingPostRequestId: string | null = null;
  private pendingRealtimeFollowIntent: boolean | null = null;
  private referenceNavigationSequence = 0;
  private lastObservedLatestPostId: string | null = null;
  private readonly pendingActionRequestIds = new Map<string, string>();

  readonly communityId = input<string>('');
  readonly view = input<CommunityFeedView>('feed');
  readonly sourceType = input<CommunityPreviewSourceType>('community');
  readonly canInteract = input<boolean>(false);
  readonly viewerRole = input<CommunityPreviewViewerRole | null>(null);
  readonly composerExpanded = signal(false);
  readonly selectedAttachment = signal<CommunityComposerAttachment | null>(null);
  readonly uploadProgress = signal<number | null>(null);
  readonly locationCaptureState = signal<'idle' | 'loading'>('idle');
  readonly actionPostId = signal<string | null>(null);
  readonly actionMode = signal<CommunityFeedPostAction | null>(null);
  readonly commentsPostId = signal<string | null>(null);
  readonly replyPostId = signal<string | null>(null);
  readonly postReplyRequestVersion = signal(0);
  readonly unseenNewPostCount = signal(0);
  readonly now = toSignal(this.timeTicker.now$, { initialValue: Date.now() });
  readonly highlightedPostId = toSignal(
    this.postHighlightRequests$.pipe(
      switchMap((postId) =>
        timer(1_800).pipe(
          map((): string | null => null),
          startWith<string | null>(postId)
        )
      )
    ),
    { initialValue: null }
  );
  private readonly reactionOverrides = signal<
    ReadonlyMap<string, CommunityFeedReactionOverride>
  >(new Map());
  private readonly commentCountOverrides = signal<ReadonlyMap<string, number>>(
    new Map()
  );
  private readonly referenceNavigationTarget = toSignal(
    this.referenceNavigationRequests$.pipe(
      switchMap((request) =>
        this.ensureReferencedPost$(request.postId).pipe(
          map(() => request),
          catchError((error: unknown) => {
            this.reportReferenceNavigationError(error);
            return EMPTY;
          })
        )
      )
    ),
    { initialValue: null }
  );
  private readonly referenceNavigationEffect = effect(() => {
    const request = this.referenceNavigationTarget();
    if (!request) return;

    const target = this.findRenderedPostElement(request.postId);
    if (!target) return;

    const element = target.nativeElement;
    if (typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({
        block: 'center',
        behavior: this.prefersReducedMotion() ? 'auto' : 'smooth',
      });
    }
    element.focus({ preventScroll: true });
    this.postHighlightRequests$.next(request.postId);
  });

  readonly postForm = new FormGroup({
    text: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(1_000)],
    }),
  });

  readonly removalReason = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(3), Validators.maxLength(240)],
  });

  private readonly feedScope$ = combineLatest([
    toObservable(this.communityId),
    toObservable(this.view),
  ]).pipe(
    map(([communityId, view]) => [communityId.trim(), view] as const),
    filter(([communityId]) => communityId.length > 0),
    distinctUntilChanged(
      ([previousId, previousView], [currentId, currentView]) =>
        previousId === currentId && previousView === currentView
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly state$ = this.feedScope$.pipe(
    switchMap(([communityId, view]) => {
      const pageEvents$ = this.loadRequests$.pipe(
        startWith<CommunityFeedLoadRequest>({
          cursor: null,
          append: false,
          preserve: true,
        }),
        exhaustMap((request) =>
          this.repository
            .getPage$({
              communityId,
              view,
              limit: 10,
              cursor: request.cursor,
            })
            .pipe(
              map(
                (page): CommunityFeedLoadEvent => ({
                  type: 'success',
                  request,
                  page,
                })
              ),
              startWith<CommunityFeedLoadEvent>({
                type: 'loading',
                request,
              }),
              catchError((error: unknown) => {
                this.reportLoadError(error, view);
                return of<CommunityFeedLoadEvent>({ type: 'error', request });
              })
            )
        )
      );

      const realtimeEvents$ = this.repository
        .watchLatestChanges$(communityId, 20)
        .pipe(
          tap((changes) => this.reconcileRealtimeOverrides(changes)),
          // Cada diff precisa concluir sua hidratação. Cancelar a chamada anterior
          // em uma rajada pode fazer um post já sinalizado nunca entrar no estado.
          concatMap((changes) =>
            this.buildRealtimeEvent$(communityId, view, changes)
          ),
          catchError((error: unknown) => {
            this.reportTechnicalError(error, 'watchRealtime', view);
            return EMPTY;
          })
        );

      const directedHydrationEvents$ = this.realtimeHydrationRequests$.pipe(
        concatMap((postId) =>
          this.repository.getItems$({
            communityId,
            view,
            postIds: [postId],
          }).pipe(
            map((page): CommunityFeedLoadEvent => ({
              type: 'realtime',
              upserts: page.items,
              metricPatches: [],
              removedIds: [],
            })),
            catchError((error: unknown) => {
              this.reportTechnicalError(error, 'hydrateRealtimeItem', view);
              return EMPTY;
            })
          )
        )
      );

      return merge(
        pageEvents$,
        realtimeEvents$,
        directedHydrationEvents$,
        this.localFeedEvents$
      ).pipe(
        scan(reduceCommunityFeedState, INITIAL_COMMUNITY_FEED_STATE)
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly orderedPostIds = toSignal(
    this.state$.pipe(
      map((state) => state.items.map((item) => item.postId)),
      distinctUntilChanged((previous, current) =>
        previous.length === current.length
        && previous.every((postId, index) => postId === current[index])
      )
    ),
    { initialValue: [] }
  );

  private readonly smartFollowEffect = effect(() => {
    const orderedPostIds = this.orderedPostIds();
    const latestPostId = orderedPostIds[0] ?? null;

    if (!latestPostId) {
      this.lastObservedLatestPostId = null;
      this.pendingRealtimeFollowIntent = null;
      this.clearUnseenNewPosts();
      return;
    }

    const previousLatestPostId = this.lastObservedLatestPostId;
    this.lastObservedLatestPostId = latestPostId;

    if (!previousLatestPostId || previousLatestPostId === latestPostId) {
      return;
    }

    const previousIndex = orderedPostIds.indexOf(previousLatestPostId);
    if (previousIndex < 1) {
      // Troca de escopo/remoção não representa conteúdo novo para o usuário.
      this.pendingRealtimeFollowIntent = null;
      this.clearUnseenNewPosts();
      return;
    }

    // Publicação própria possui um efeito dedicado para localizar exatamente o
    // post criado mesmo se outro item entrar no realtime no mesmo instante.
    const ownPostId = this.pendingOwnPostFollowId();
    if (ownPostId) {
      this.pendingRealtimeFollowIntent = null;
      const externalNewPostIds = orderedPostIds
        .slice(0, previousIndex)
        .filter((postId) => postId !== ownPostId);
      if (externalNewPostIds.length > 0) {
        this.unseenAnchorPostId.set(externalNewPostIds[0] ?? null);
        this.unseenNewPostCount.update((current) =>
          Math.min(MAX_UNSEEN_NEW_POSTS, current + externalNewPostIds.length)
        );
      }
      return;
    }

    const shouldFollow = this.pendingRealtimeFollowIntent
      ?? this.isPostInsideFollowZone(previousLatestPostId);
    this.pendingRealtimeFollowIntent = null;

    queueMicrotask(() => {
      if (shouldFollow) {
        this.clearUnseenNewPosts();
        this.postHighlightRequests$.next(latestPostId);
        this.scrollToLatestPost('nearest');
        return;
      }

      this.unseenAnchorPostId.set(latestPostId);
      this.unseenNewPostCount.update((current) =>
        Math.min(MAX_UNSEEN_NEW_POSTS, current + previousIndex)
      );
    });
  });

  private readonly ownPostFollowEffect = effect(() => {
    const postId = this.pendingOwnPostFollowId();
    if (!postId) return;

    const target = this.findRenderedPostElement(postId);
    if (!target) return;

    queueMicrotask(() => {
      this.postHighlightRequests$.next(postId);
      this.scrollPostIntoView(target.nativeElement, 'nearest');
      // Novidades externas já contabilizadas não são consumidas pela publicação própria.
      this.pendingOwnPostFollowId.set(null);
    });
  });

  readonly postCreateState$ = this.postCreateRequests$.pipe(
    exhaustMap((command) =>
      this.createMessage$(command).pipe(
        tap((result) => {
          this.pendingPostRequestId = null;
          this.postForm.reset({ text: '' });
          this.clearSelectedAttachment();
          this.composerExpanded.set(false);
          this.followCreatedPost(result.postId);
          this.showPostSuccess(result.deduplicated);
        }),
        map((): CommunityFeedPostWriteState => ({ status: 'idle' })),
        startWith<CommunityFeedPostWriteState>({ status: 'loading' }),
        catchError(() => of<CommunityFeedPostWriteState>({ status: 'error' }))
      )
    ),
    startWith<CommunityFeedPostWriteState>({ status: 'idle' }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly postActionState$ = this.postActionRequests$.pipe(
    exhaustMap((request) =>
      this.repository.moderatePost$(request).pipe(
        tap((result) => {
          this.pendingActionRequestIds.delete(
            this.actionRequestKey(result.postId, result.action)
          );
          this.actionPostId.set(null);
          this.actionMode.set(null);
          this.removalReason.reset('');
          this.clearItemOverrides(result.postId);
          this.localFeedEvents$.next({
            type: 'realtime',
            upserts: [],
            metricPatches: [],
            removedIds: [result.postId],
          });
          this.showPostActionSuccess(result.action, result.deduplicated);
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
          this.reportPostActionError(error, request.action);
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

  readonly reactionState$ = this.reactionRequests$.pipe(
    concatMap((command) =>
      this.repository.toggleReaction$(command.request).pipe(
        tap((result) => {
          this.setReactionOverride(result.postId, {
            reacted: result.reacted,
            reactionCount: result.reactionCount,
          });
        }),
        map((): CommunityFeedReactionState => ({ status: 'idle', postId: null })),
        startWith<CommunityFeedReactionState>({
          status: 'loading',
          postId: command.request.postId,
        }),
        catchError((error: unknown) => {
          this.setReactionOverride(command.request.postId, command.previous);
          this.reportReactionError(error);
          return of<CommunityFeedReactionState>({
            status: 'error',
            postId: command.request.postId,
          });
        }),
        finalize(() => this.pendingReactionPostIds.delete(command.request.postId))
      )
    ),
    startWith<CommunityFeedReactionState>({ status: 'idle', postId: null }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  ngOnDestroy(): void {
    this.revokePreviewUrl(this.selectedImagePreviewUrl());
    this.locationEmbedUrlCache.clear();
  }

  canCreatePost(): boolean {
    return this.view() === 'feed'
      && this.sourceType() === 'community'
      && this.canInteract();
  }

  expandComposer(): void {
    if (this.canCreatePost()) this.composerExpanded.set(true);
  }

  cancelPost(): void {
    this.pendingPostRequestId = null;
    this.postForm.reset({ text: '' });
    this.clearSelectedAttachment();
    this.uploadProgress.set(null);
    this.composerExpanded.set(false);
  }

  onPhotoSelected(event: Event): void {
    if (!this.canCreatePost()) return;

    const inputElement = event.target as HTMLInputElement | null;
    const file = inputElement?.files?.[0] ?? null;
    if (inputElement) inputElement.value = '';
    if (!file) return;

    const validation = validateCommunityComposerImage(file);
    if (!validation.valid) {
      this.errorNotifier.showWarning(validation.userMessage);
      return;
    }

    this.clearSelectedAttachment();
    this.selectedAttachment.set({
      kind: 'image',
      file,
      previewUrl: this.createPreviewUrl(file),
    });
    this.composerExpanded.set(true);
  }

  removeSelectedPhoto(): void {
    this.clearSelectedAttachment();
  }

  shareApproximateLocation(): void {
    if (!this.canCreatePost() || this.locationCaptureState() === 'loading') return;

    const menu = this.attachmentMenu()?.nativeElement;
    if (menu) menu.open = false;
    this.locationCaptureState.set('loading');

    this.geolocation.currentPosition$({
      enableHighAccuracy: false,
      timeout: 10_000,
      maximumAge: 60_000,
    }).pipe(
      take(1),
      map((coordinates) =>
        createCommunityComposerLocationAttachment(
          coordinates.latitude,
          coordinates.longitude
        )
      ),
      tap((attachment) => {
        if (!attachment) {
          throw new Error('Coordenadas inválidas para compartilhamento no Mural.');
        }
        this.clearSelectedAttachment();
        this.selectedAttachment.set(attachment);
        this.composerExpanded.set(true);
        this.errorNotifier.showSuccess('Localização aproximada adicionada.');
      }),
      catchError((error: unknown) => {
        this.reportLocationError(error);
        return EMPTY;
      }),
      finalize(() => this.locationCaptureState.set('idle')),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  approximateLocationLabel(latitude: number, longitude: number): string {
    return `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`;
  }

  locationMapEmbedUrl(item: CommunityFeedItem): SafeResourceUrl | null {
    const coordinates = this.normalizedMapCoordinates(item);
    if (!coordinates) return null;

    const cached = this.locationEmbedUrlCache.get(coordinates.cacheKey);
    if (cached) return cached;

    const trusted = this.sanitizer.bypassSecurityTrustResourceUrl(
      `https://www.google.com/maps?q=${coordinates.latitude},${coordinates.longitude}&z=14&output=embed`
    );

    if (this.locationEmbedUrlCache.size >= MAX_LOCATION_EMBED_URL_CACHE_ENTRIES) {
      const oldestKey = this.locationEmbedUrlCache.keys().next().value as string | undefined;
      if (oldestKey) this.locationEmbedUrlCache.delete(oldestKey);
    }
    this.locationEmbedUrlCache.set(coordinates.cacheKey, trusted);
    return trusted;
  }

  locationMapUrl(item: CommunityFeedItem): string {
    const coordinates = this.normalizedMapCoordinates(item);
    if (!coordinates) return '#';
    const query = encodeURIComponent(
      `${coordinates.latitude},${coordinates.longitude}`
    );
    return `https://www.google.com/maps/search/?api=1&query=${query}`;
  }

  submitPostOnEnter(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.isComposing || keyboardEvent.shiftKey) {
      return;
    }

    event.preventDefault();
    if (keyboardEvent.repeat) {
      return;
    }

    this.submitPost();
  }

  submitPost(): void {
    if (!this.canCreatePost()) return;

    const text = this.postForm.controls.text.value.trim();
    const attachment = this.selectedAttachment();
    if (this.postForm.invalid) {
      this.postForm.markAllAsTouched();
      this.errorNotifier.showWarning('A mensagem deve ter no máximo 1.000 caracteres.');
      return;
    }
    if (!text && !attachment) {
      this.errorNotifier.showWarning('Escreva uma mensagem ou adicione uma foto ou localização.');
      return;
    }

    this.pendingPostRequestId ??= this.createRequestId();
    this.postCreateRequests$.next({
      request: {
        requestId: this.pendingPostRequestId,
        communityId: this.communityId().trim(),
        text,
        // Compatibilidade de transporte. O backend deriva a audiência efetiva
        // exclusivamente da visibilidade configurada para a Comunidade.
        audience: 'members_only',
        imageUploadPath: null,
        location: attachment?.kind === 'location'
          ? { latitude: attachment.latitude, longitude: attachment.longitude }
          : null,
      },
      attachment,
    });
  }

  requestPostAction(item: CommunityFeedItem, action: CommunityFeedPostAction): void {
    const allowed = action === 'delete_own'
      ? item.capabilities.canDeleteOwn
      : item.capabilities.canModerate;
    if (!allowed) return;

    this.actionPostId.set(item.postId);
    this.actionMode.set(action);
    this.removalReason.reset('');
  }

  cancelPostAction(): void {
    const postId = this.actionPostId();
    const action = this.actionMode();
    if (postId && action) {
      this.pendingActionRequestIds.delete(this.actionRequestKey(postId, action));
    }
    this.actionPostId.set(null);
    this.actionMode.set(null);
    this.removalReason.reset('');
  }

  confirmPostAction(item: CommunityFeedItem): void {
    const action = this.actionMode();
    if (!action || this.actionPostId() !== item.postId) return;

    const allowed = action === 'delete_own'
      ? item.capabilities.canDeleteOwn
      : item.capabilities.canModerate;
    if (!allowed) return;

    const reason = action === 'remove' ? this.removalReason.value.trim() : null;
    if (action === 'remove' && this.removalReason.invalid) {
      this.removalReason.markAsTouched();
      this.errorNotifier.showWarning('Informe o motivo da remoção.');
      return;
    }

    const key = this.actionRequestKey(item.postId, action);
    const requestId = this.pendingActionRequestIds.get(key) ?? this.createRequestId();
    this.pendingActionRequestIds.set(key, requestId);
    this.postActionRequests$.next({
      requestId,
      communityId: this.communityId().trim(),
      postId: item.postId,
      action,
      reason,
    });
  }

  toggleReaction(item: CommunityFeedItem): void {
    if (!item.capabilities.canReact || this.pendingReactionPostIds.has(item.postId)) {
      return;
    }

    const previous: CommunityFeedReactionOverride = {
      reacted: this.viewerReacted(item),
      reactionCount: this.reactionCount(item),
    };
    const optimistic: CommunityFeedReactionOverride = {
      reacted: !previous.reacted,
      reactionCount: previous.reacted
        ? Math.max(0, previous.reactionCount - 1)
        : Math.min(1_000_000_000, previous.reactionCount + 1),
    };

    this.pendingReactionPostIds.add(item.postId);
    this.setReactionOverride(item.postId, optimistic);
    this.reactionRequests$.next({
      request: {
        communityId: this.communityId().trim(),
        postId: item.postId,
      },
      previous,
    });
  }

  reactionCount(item: CommunityFeedItem): number {
    return this.reactionOverrides().get(this.reactionKey(item.postId))
      ?.reactionCount ?? item.metrics.reactionCount;
  }

  viewerReacted(item: CommunityFeedItem): boolean {
    return this.reactionOverrides().get(this.reactionKey(item.postId))
      ?.reacted ?? item.capabilities.viewerReacted;
  }

  navigateToReferencedPost(event: Event, postId: string): void {
    const normalizedPostId = postId.trim();
    if (!normalizedPostId) return;

    event.preventDefault();
    this.referenceNavigationSequence += 1;
    this.referenceNavigationRequests$.next({
      postId: normalizedPostId,
      sequence: this.referenceNavigationSequence,
    });
  }

  followCreatedPost(postId: string): void {
    const normalizedPostId = postId.trim();
    if (!normalizedPostId) return;

    this.pendingOwnPostFollowId.set(normalizedPostId);
    this.realtimeHydrationRequests$.next(normalizedPostId);
  }

  @HostListener('document:pointerdown', ['$event'])
  onDocumentPointerDown(event: Event): void {
    const menu = this.attachmentMenu()?.nativeElement;
    const target = event.target;
    if (!menu?.open || !(target instanceof Node) || menu.contains(target)) return;
    menu.open = false;
  }

  @HostListener('document:keydown.escape')
  onDocumentEscape(): void {
    const menu = this.attachmentMenu()?.nativeElement;
    if (menu?.open) menu.open = false;
  }

  @HostListener('window:scroll')
  onViewportScroll(): void {
    if (this.unseenNewPostCount() <= 0) return;

    const anchorPostId = this.unseenAnchorPostId();
    if (!anchorPostId || !this.isPostInsideFollowZone(anchorPostId)) return;

    this.clearUnseenNewPosts();
  }

  showLatestPosts(): void {
    const latestPostId = this.orderedPostIds()[0] ?? null;
    this.clearUnseenNewPosts();
    if (latestPostId) this.postHighlightRequests$.next(latestPostId);
    this.scrollToLatestPost('start');
  }

  newPostsLabel(): string {
    const count = this.unseenNewPostCount();
    return count === 1
      ? '1 nova publicação'
      : `${count} novas publicações`;
  }

  toggleComments(item: CommunityFeedItem): void {
    if (!item.capabilities.canViewComments) return;
    const isOpen = this.commentsPostId() === item.postId;
    this.commentsPostId.set(isOpen ? null : item.postId);
    // Abrir pelo contador é modo de leitura; não deve herdar intenção de resposta.
    this.replyPostId.set(null);
  }

  openCommentsForReply(item: CommunityFeedItem): void {
    if (!item.capabilities.canViewComments || !item.capabilities.canComment) return;
    this.commentsPostId.set(item.postId);
    this.replyPostId.set(item.postId);
    this.postReplyRequestVersion.update((current) => current + 1);
  }

  clearPostReplyContext(item: CommunityFeedItem): void {
    if (this.replyPostId() === item.postId) {
      this.replyPostId.set(null);
    }
  }

  commentsOpen(item: CommunityFeedItem): boolean {
    return this.commentsPostId() === item.postId;
  }

  commentCount(item: CommunityFeedItem): number {
    return this.commentCountOverrides().get(item.postId)
      ?? item.metrics.commentCount;
  }

  updateCommentCount(item: CommunityFeedItem, commentCount: number): void {
    if (!Number.isFinite(commentCount) || commentCount < 0) return;
    const next = new Map(this.commentCountOverrides());
    next.set(item.postId, Math.trunc(commentCount));
    this.commentCountOverrides.set(next);
  }

  loadMore(cursor: string | null): void {
    if (cursor) this.loadRequests$.next({ cursor, append: true });
  }

  retry(): void {
    this.loadRequests$.next({ cursor: null, append: false, preserve: true });
  }

  sectionAriaLabel(): string {
    if (this.view() === 'photos') {
      return this.sourceType() === 'venue'
        ? 'Fotos do Local'
        : 'Fotos da Comunidade';
    }

    return this.sourceType() === 'venue'
      ? 'Novidades do Local'
      : 'Mural da Comunidade';
  }

  loadingLabel(): string {
    if (this.view() === 'photos') return 'Carregando fotos...';
    return this.sourceType() === 'venue'
      ? 'Carregando novidades...'
      : 'Carregando mural...';
  }

  errorStateLabel(): string {
    if (this.view() === 'photos') return 'Não foi possível carregar as fotos.';
    return this.sourceType() === 'venue'
      ? 'Não foi possível carregar as novidades.'
      : 'Não foi possível carregar o mural da Comunidade.';
  }

  emptyLabel(): string {
    if (this.view() === 'photos') return 'Nenhuma foto compartilhada ainda.';
    return this.sourceType() === 'venue'
      ? 'Nenhuma novidade publicada.'
      : 'Nenhuma mensagem no Mural ainda.';
  }

  publishedIso(publishedAt: number): string {
    return formatCommunityFeedIso(publishedAt);
  }

  publishedLabel(publishedAt: number): string {
    return formatCommunityFeedTime(publishedAt, this.now());
  }

  private normalizedMapCoordinates(
    item: CommunityFeedItem
  ): CommunityFeedMapCoordinates | null {
    const location = item.location;
    if (!location) return null;

    const latitude = Number(location.latitude);
    const longitude = Number(location.longitude);
    if (
      !Number.isFinite(latitude)
      || !Number.isFinite(longitude)
      || latitude < -90
      || latitude > 90
      || longitude < -180
      || longitude > 180
    ) {
      return null;
    }

    const roundedLatitude = Math.round(latitude * 100) / 100;
    const roundedLongitude = Math.round(longitude * 100) / 100;
    const normalizedLatitude = Object.is(roundedLatitude, -0) ? 0 : roundedLatitude;
    const normalizedLongitude = Object.is(roundedLongitude, -0) ? 0 : roundedLongitude;

    return {
      latitude: normalizedLatitude,
      longitude: normalizedLongitude,
      cacheKey: `${normalizedLatitude.toFixed(2)},${normalizedLongitude.toFixed(2)}`,
    };
  }

  private ensureReferencedPost$(postId: string): Observable<void> {
    if (this.findRenderedPostElement(postId)) {
      return of(undefined);
    }

    const communityId = this.communityId().trim();
    if (!communityId) {
      return throwError(() => new Error('Comunidade não disponível para localizar a publicação original.'));
    }

    return this.repository.getItems$({
      communityId,
      view: this.view(),
      postIds: [postId],
    }).pipe(
      map((page) => page.items.find((item) => item.postId === postId) ?? null),
      tap((item) => {
        if (!item) {
          throw new Error('Publicação original não encontrada no Mural.');
        }
        this.localFeedEvents$.next({
          type: 'realtime',
          upserts: [item],
          metricPatches: [],
          removedIds: [],
        });
      }),
      map(() => undefined)
    );
  }

  private findRenderedPostElement(postId: string): ElementRef<HTMLElement> | null {
    return this.postElements().find(
      (element) => element.nativeElement.dataset['postId'] === postId
    ) ?? null;
  }

  private isPostInsideFollowZone(postId: string): boolean {
    const element = this.findRenderedPostElement(postId)?.nativeElement;
    if (!element || typeof window === 'undefined') return true;

    const rect = element.getBoundingClientRect();
    const viewportHeight = window.innerHeight
      || globalThis.document?.documentElement?.clientHeight
      || 0;
    if (viewportHeight <= 0) return true;

    // A decisão é capturada antes da hidratação do novo item. Assim uma foto ou
    // mensagem longa não muda retroativamente a intenção de acompanhar o topo.
    return rect.bottom >= 0 && rect.top <= viewportHeight * 0.55;
  }

  private clearUnseenNewPosts(): void {
    this.unseenNewPostCount.set(0);
    this.unseenAnchorPostId.set(null);
  }

  private scrollToLatestPost(
    block: ScrollLogicalPosition = 'nearest'
  ): void {
    const latest = this.postElements()[0]?.nativeElement;
    if (!latest) return;
    this.scrollPostIntoView(latest, block);
  }

  private scrollPostIntoView(
    element: HTMLElement,
    block: ScrollLogicalPosition
  ): void {
    if (typeof element.scrollIntoView !== 'function') return;
    element.scrollIntoView({
      block,
      behavior: this.prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }

  private prefersReducedMotion(): boolean {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private buildRealtimeEvent$(
    communityId: string,
    view: CommunityFeedView,
    changes: readonly CommunityFeedRealtimeChange[]
  ): Observable<CommunityFeedLoadEvent> {
    const relevant = changes.filter((change) =>
      view === 'feed' || change.projection.kind === 'photo'
    );
    if (relevant.length === 0) return EMPTY;

    const removedIds = relevant
      .filter((change) =>
        change.type === 'removed' || change.projection.state === 'removed'
      )
      .map((change) => change.projection.postId);
    const active = relevant.filter((change) =>
      change.type !== 'removed' && change.projection.state === 'active'
    );
    const metricPatches = active.map((change) => ({
      postId: change.projection.postId,
      metrics: { ...change.projection.metrics },
    }));
    const addedIds = active
      .filter((change) => change.type === 'added')
      .map((change) => change.projection.postId);
    const baseEvent: CommunityFeedLoadEvent = {
      type: 'realtime',
      upserts: [],
      metricPatches,
      removedIds,
    };

    if (addedIds.length === 0) return of(baseEvent);

    const currentLatestPostId = this.orderedPostIds()[0] ?? null;
    const shouldFollowLatest = this.unseenNewPostCount() === 0
      && (currentLatestPostId
        ? this.isPostInsideFollowZone(currentLatestPostId)
        : true);

    return this.repository.getItems$({
      communityId,
      view,
      postIds: addedIds,
    }).pipe(
      map((page): CommunityFeedLoadEvent => {
        // Rajadas podem hidratar mais de um diff antes do próximo ciclo visual.
        // Uma decisão de preservar a leitura nunca deve ser sobrescrita por uma
        // chegada posterior cuja referência ainda nem foi renderizada no DOM.
        this.pendingRealtimeFollowIntent = this.pendingRealtimeFollowIntent === null
          ? shouldFollowLatest
          : this.pendingRealtimeFollowIntent && shouldFollowLatest;
        return {
          ...baseEvent,
          upserts: page.items,
        };
      }),
      catchError((error: unknown) => {
        this.pendingRealtimeFollowIntent = null;
        this.reportTechnicalError(error, 'hydrateRealtimeItem', view);
        return of(baseEvent);
      })
    );
  }

  private reconcileRealtimeOverrides(
    changes: readonly CommunityFeedRealtimeChange[]
  ): void {
    let reactionMap: Map<string, CommunityFeedReactionOverride> | null = null;
    let commentMap: Map<string, number> | null = null;

    for (const change of changes) {
      const postId = change.projection.postId;
      const key = this.reactionKey(postId);
      const removed = change.type === 'removed'
        || change.projection.state === 'removed';

      if (removed) {
        if (this.reactionOverrides().has(key)) {
          reactionMap ??= new Map(this.reactionOverrides());
          reactionMap.delete(key);
        }
        if (this.commentCountOverrides().has(postId)) {
          commentMap ??= new Map(this.commentCountOverrides());
          commentMap.delete(postId);
        }
        continue;
      }

      const currentReaction = this.reactionOverrides().get(key);
      if (currentReaction) {
        reactionMap ??= new Map(this.reactionOverrides());
        reactionMap.set(key, {
          reacted: currentReaction.reacted,
          reactionCount: change.projection.metrics.reactionCount,
        });
      }
      if (this.commentCountOverrides().has(postId)) {
        commentMap ??= new Map(this.commentCountOverrides());
        commentMap.set(postId, change.projection.metrics.commentCount);
      }
    }

    if (reactionMap) this.reactionOverrides.set(reactionMap);
    if (commentMap) this.commentCountOverrides.set(commentMap);
  }

  private setReactionOverride(
    postId: string,
    override: CommunityFeedReactionOverride
  ): void {
    const next = new Map(this.reactionOverrides());
    next.set(this.reactionKey(postId), override);
    this.reactionOverrides.set(next);
  }

  private clearItemOverrides(postId: string): void {
    const reactionKey = this.reactionKey(postId);
    if (this.reactionOverrides().has(reactionKey)) {
      const next = new Map(this.reactionOverrides());
      next.delete(reactionKey);
      this.reactionOverrides.set(next);
    }
    if (this.commentCountOverrides().has(postId)) {
      const next = new Map(this.commentCountOverrides());
      next.delete(postId);
      this.commentCountOverrides.set(next);
    }
    if (this.replyPostId() === postId) {
      this.replyPostId.set(null);
    }
  }

  private createMessage$(
    command: CommunityFeedComposerCommand
  ): Observable<CommunityFeedPostCreateResponse> {
    const publish = (imageUploadPath: string | null) =>
      this.repository.createPost$({
        ...command.request,
        imageUploadPath,
      }).pipe(
        catchError((error: unknown) => {
          this.reportPostWriteError(error);
          return throwError(() => error);
        })
      );

    if (!command.attachment || command.attachment.kind === 'location') {
      return publish(null);
    }

    return this.uploadAttachment$(command.attachment).pipe(
      switchMap((imageUploadPath) => publish(imageUploadPath))
    );
  }

  private uploadAttachment$(
    attachment: CommunityComposerAttachment
  ): Observable<string> {
    switch (attachment.kind) {
      case 'image': {
        const authSession = this.injector.get(AuthSessionService);
        const storage = this.injector.get(StorageService);
        const uid = authSession.currentAuthUser?.uid?.trim() || '';
        if (!uid) {
          const error = new Error('Sessão não encontrada para enviar a foto.');
          this.errorNotifier.showError(
            'Sua sessão precisa ser atualizada para enviar a foto.'
          );
          this.reportTechnicalError(error, 'createPost');
          return throwError(() => error);
        }

        this.uploadProgress.set(0);
        return storage.uploadFile(
          attachment.file,
          'community-feed',
          uid,
          (progress) => this.uploadProgress.set(
            Math.max(0, Math.min(100, Math.round(progress)))
          )
        ).pipe(finalize(() => this.uploadProgress.set(null)));
      }
      case 'location':
        return throwError(() =>
          new Error('Localização não requer upload de arquivo.')
        );
    }
  }

  private createPreviewUrl(file: File): string | null {
    try {
      return typeof URL?.createObjectURL === 'function'
        ? URL.createObjectURL(file)
        : null;
    } catch {
      return null;
    }
  }

  private selectedImagePreviewUrl(): string | null {
    const attachment = this.selectedAttachment();
    return attachment?.kind === 'image' ? attachment.previewUrl : null;
  }

  private revokePreviewUrl(previewUrl: string | null): void {
    if (!previewUrl) return;
    try {
      URL.revokeObjectURL(previewUrl);
    } catch {
      // Preview local descartável; falha de revoke não afeta o fluxo.
    }
  }

  private clearSelectedAttachment(): void {
    this.revokePreviewUrl(this.selectedImagePreviewUrl());
    this.selectedAttachment.set(null);
  }

  private createRequestId(): string {
    try {
      const randomUuid = globalThis.crypto?.randomUUID?.();
      if (randomUuid) return randomUuid;
    } catch {
      // O fallback mantém a idempotência deste rascunho.
    }

    return `mural-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 14)}`;
  }

  private actionRequestKey(postId: string, action: CommunityFeedPostAction): string {
    return `${action}:${postId}`;
  }

  private reactionKey(postId: string): string {
    return `${this.communityId().trim()}:${postId}`;
  }

  private showPostSuccess(deduplicated: boolean): void {
    try {
      this.errorNotifier.showSuccess(
        deduplicated ? 'Mensagem confirmada.' : 'Mensagem enviada.'
      );
    } catch {
      // A atualização reativa do Mural já confirma a operação visualmente.
    }
  }

  private showPostActionSuccess(
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

  private reportPostActionError(
    error: unknown,
    action: CommunityFeedPostAction
  ): void {
    try {
      this.errorNotifier.showError(
        action === 'delete_own'
          ? 'Não foi possível excluir a mensagem agora.'
          : 'Não foi possível remover a mensagem agora.'
      );
    } catch {
      // O diagnóstico centralizado abaixo permanece ativo.
    }
    this.reportTechnicalError(error, 'moderatePost');
  }

  private reportReactionError(error: unknown): void {
    const source = (error ?? {}) as { code?: unknown };
    const code = String(source.code ?? '').replace(/^functions\//, '');
    try {
      this.errorNotifier.showError(
        code === 'resource-exhausted'
          ? 'Você reagiu muitas vezes em pouco tempo. Aguarde um instante.'
          : 'Não foi possível atualizar sua reação agora.'
      );
    } catch {
      // O diagnóstico centralizado abaixo permanece ativo.
    }
    this.reportTechnicalError(error, 'toggleReaction');
  }

  private reportPostWriteError(error: unknown): void {
    const source = (error ?? {}) as {
      code?: unknown;
      details?: { reason?: unknown };
    };
    const code = String(source.code ?? '').replace(/^functions\//, '');
    const reason = String(source.details?.reason ?? '');
    const message = code === 'resource-exhausted'
      || reason === 'community_feed_rate_limited'
      ? 'Você atingiu o limite temporário de mensagens. Tente mais tarde.'
      : 'Não foi possível enviar a mensagem agora.';

    try {
      this.errorNotifier.showError(message);
    } catch {
      // O diagnóstico centralizado abaixo permanece ativo.
    }

    this.reportTechnicalError(error, 'createPost');
  }

  private reportLocationError(error: unknown): void {
    let message = 'Não foi possível obter sua localização agora.';

    if (error instanceof GeolocationError) {
      switch (error.code) {
        case GeolocationErrorCode.PERMISSION_DENIED:
          message = 'Permita o acesso à localização no navegador para compartilhar sua posição.';
          break;
        case GeolocationErrorCode.TIMEOUT:
          message = 'A localização demorou demais para responder. Tente novamente.';
          break;
        case GeolocationErrorCode.UNSUPPORTED:
        case GeolocationErrorCode.INSECURE_CONTEXT:
          message = 'A localização não está disponível neste navegador ou ambiente.';
          break;
        case GeolocationErrorCode.POSITION_UNAVAILABLE:
          message = 'Sua posição não está disponível neste momento.';
          break;
        default:
          break;
      }
    }

    try {
      this.errorNotifier.showWarning(message);
    } catch {
      // O diagnóstico centralizado abaixo permanece ativo.
    }
    this.reportTechnicalError(error, 'shareLocation');
  }

  private reportReferenceNavigationError(error: unknown): void {
    try {
      this.errorNotifier.showWarning(
        'A publicação original não está disponível neste momento.'
      );
    } catch {
      // O diagnóstico centralizado abaixo permanece ativo.
    }

    this.reportTechnicalError(error, 'navigateReference');
  }

  private reportLoadError(error: unknown, view: CommunityFeedView): void {
    try {
      this.errorNotifier.showError(
        view === 'photos'
          ? 'Não foi possível carregar as fotos agora.'
          : this.sourceType() === 'venue'
            ? 'Não foi possível carregar as novidades do Local agora.'
            : 'Não foi possível carregar o mural da Comunidade agora.'
      );
    } catch {
      // O diagnóstico técnico abaixo permanece ativo.
    }

    this.reportTechnicalError(error, 'loadPage', view);
  }

  private reportTechnicalError(
    error: unknown,
    op:
      | 'loadPage'
      | 'createPost'
      | 'moderatePost'
      | 'toggleReaction'
      | 'watchRealtime'
      | 'hydrateRealtimeItem'
      | 'navigateReference'
      | 'shareLocation',
    view: CommunityFeedView = this.view()
  ): void {
    try {
      const normalized = error instanceof Error ? error : new Error(String(error));
      const contextual = normalized as Error & {
        context?: unknown;
        skipUserNotification?: boolean;
      };
      contextual.context = {
        scope: 'CommunityFeedComponent',
        op,
        view,
        sourceType: this.sourceType(),
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // Falha secundária não interrompe o estado visual.
    }
  }
}
