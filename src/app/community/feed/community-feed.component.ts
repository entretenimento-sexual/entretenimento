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
  map,
  merge,
  of,
  scan,
  shareReplay,
  startWith,
  Subject,
  switchMap,
  tap,
  timer,
} from 'rxjs';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { ImageFallbackDirective } from 'src/app/shared/directives/image-fallback.directive';
import { ReportContentButtonComponent } from 'src/app/shared/components-globais/moderation-report/report-content-button/report-content-button.component';
import {
  CommunityFeedItem,
  CommunityFeedPostAction,
  CommunityFeedPostActionRequest,
  CommunityFeedView,
} from '../data-access/community-feed.model';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';
import type { CommunityFeedRealtimeChange } from '../data-access/community-feed-realtime.model';
import { CommunityFeedCommentsComponent } from '../feed-comments/community-feed-comments.component';
import { CommunityHighlightCardComponent } from '../highlight/community-highlight-card.component';
import { CommunityHighlightMenuActionComponent } from '../highlight/community-highlight-menu-action.component';
import {
  CommunityPreviewSourceType,
  CommunityPreviewViewerRole,
} from '../data-access/community-preview.model';
import {
  COMMUNITY_FEED_POST_ACTION_CODE_MESSAGES,
  COMMUNITY_FEED_POST_REASON_MESSAGES,
} from '../presentation/community-error.messages';
import { CommunityCameraCaptureComponent } from './community-camera-capture.component';
import {
  CommunityFeedComposerContext,
  CommunityFeedComposerFacade,
} from './community-feed-composer.facade';
import {
  dismissOpenCommunityFeedDetailsOnEscape,
  dismissOpenCommunityFeedDetailsOutside,
} from './community-feed-disclosure-menu.util';
import { CommunityFeedReactionFacade } from './community-feed-reaction.facade';
import { CommunityFeedReferenceNavigationFacade } from './community-feed-reference-navigation.facade';
import { createCommunityFeedRequestId } from './community-feed-request-id';
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

type CommunityFeedPostActionState =
  | { status: 'idle'; postId: null; action: null }
  | {
      status: 'loading' | 'error';
      postId: string;
      action: CommunityFeedPostAction;
    };

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
    CommunityHighlightCardComponent,
    CommunityHighlightMenuActionComponent,
    CommunityCameraCaptureComponent,
  ],
  providers: [
    CommunityFeedComposerFacade,
    CommunityFeedReactionFacade,
    CommunityFeedReferenceNavigationFacade,
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
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly timeTicker = inject(CommunityFeedTimeTickerService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly composer = inject(CommunityFeedComposerFacade);
  private readonly reactions = inject(CommunityFeedReactionFacade);
  private readonly references = inject(CommunityFeedReferenceNavigationFacade);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly loadRequests$ = new Subject<CommunityFeedLoadRequest>();
  private readonly realtimeHydrationRequests$ = new Subject<string>();
  private readonly localFeedEvents$ = new Subject<CommunityFeedLoadEvent>();
  private readonly postActionRequests$ =
    new Subject<CommunityFeedPostActionRequest>();
  private readonly postHighlightRequests$ = new Subject<string>();
  private readonly locationEmbedUrlCache = new Map<string, SafeResourceUrl>();
  private readonly postElements = viewChildren<ElementRef<HTMLElement>>('postElement');
  private readonly postMenus = viewChildren<ElementRef<HTMLDetailsElement>>('postMenu');
  private readonly attachmentMenu = viewChild<ElementRef<HTMLDetailsElement>>('attachmentMenu');
  private readonly pendingOwnPostFollowId = signal<string | null>(null);
  private readonly unseenAnchorPostId = signal<string | null>(null);
  private pendingRealtimeFollowIntent: boolean | null = null;
  private lastObservedLatestPostId: string | null = null;
  private readonly pendingActionRequestIds = new Map<string, string>();

  readonly communityId = input<string>('');
  readonly view = input<CommunityFeedView>('feed');
  readonly sourceType = input<CommunityPreviewSourceType>('community');
  readonly canInteract = input<boolean>(false);
  readonly viewerRole = input<CommunityPreviewViewerRole | null>(null);
  readonly composerExpanded = this.composer.composerExpanded;
  readonly selectedAttachment = this.composer.selectedAttachment;
  readonly uploadProgress = this.composer.uploadProgress;
  readonly locationCaptureState = this.composer.locationCaptureState;
  readonly actionPostId = signal<string | null>(null);
  readonly actionMode = signal<CommunityFeedPostAction | null>(null);
  readonly commentsPostId = signal<string | null>(null);
  readonly replyPostId = signal<string | null>(null);
  readonly postReplyRequestVersion = signal(0);
  readonly unseenNewPostCount = signal(0);
  readonly referenceNavigationState = this.references.navigationState;
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
  private readonly commentCountOverrides = signal<ReadonlyMap<string, number>>(
    new Map()
  );

  readonly postForm = this.composer.postForm;

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
          tap((changes) => this.reconcileRealtimeOverrides(changes, communityId)),
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

  readonly postCreateState$ = this.composer.postCreateState$;

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

  readonly reactionState$ = this.reactions.reactionState$;

  constructor() {
    this.composer.postCreated$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => this.followCreatedPost(result.postId));

    this.references.referencedItem$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((item) => {
        this.localFeedEvents$.next({
          type: 'reference',
          item,
        });
      });

    this.references.navigationTarget$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((navigation) => {
        const element = navigation.target.nativeElement;
        if (typeof element.scrollIntoView === 'function') {
          element.scrollIntoView({
            block: 'start',
            behavior: this.prefersReducedMotion() ? 'auto' : 'smooth',
          });
        }
        element.focus({ preventScroll: true });
        this.postHighlightRequests$.next(navigation.postId);
      });
  }

  ngOnDestroy(): void {
    this.locationEmbedUrlCache.clear();
  }

  canCreatePost(): boolean {
    return this.composer.canCreatePost(this.composerContext());
  }

  expandComposer(): void {
    this.composer.expandComposer(this.composerContext());
  }

  cancelPost(): void {
    this.composer.cancelPost();
  }

  onPhotoSelected(event: Event): void {
    this.composer.onPhotoSelected(event, this.composerContext());
  }

  removeSelectedPhoto(): void {
    this.composer.removeSelectedPhoto();
  }

  // Nome preservado para não quebrar bindings/testes existentes. O fluxo agora
  // observa refinamentos do provedor e escolhe a leitura com menor margem de erro.
  shareApproximateLocation(): void {
    if (!this.canCreatePost() || this.locationCaptureState() === 'loading') return;

    const menu = this.attachmentMenu()?.nativeElement;
    if (menu) menu.open = false;
    this.composer.shareApproximateLocation(this.composerContext());
  }

  approximateLocationLabel(latitude: number, longitude: number): string {
    return this.composer.approximateLocationLabel(latitude, longitude);
  }

  locationAccuracyLabel(accuracyMeters: number | null | undefined): string {
    return this.composer.locationAccuracyLabel(accuracyMeters);
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
    this.composer.submitPostOnEnter(event, this.composerContext());
  }

  submitPost(): void {
    this.composer.submitPost(this.composerContext());
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
    this.reactions.toggleReaction(item, {
      communityId: this.communityId().trim(),
      view: this.view(),
      sourceType: this.sourceType(),
    });
  }

  reactionCount(item: CommunityFeedItem): number {
    return this.reactions.reactionCount(item, this.communityId().trim());
  }

  viewerReacted(item: CommunityFeedItem): boolean {
    return this.reactions.viewerReacted(item, this.communityId().trim());
  }

  navigateToReferencedPost(event: Event, postId: string): void {
    const normalizedPostId = postId.trim();
    if (!normalizedPostId) return;

    event.preventDefault();
    this.references.navigate(
      normalizedPostId,
      {
        communityId: this.communityId().trim(),
        view: this.view(),
        sourceType: this.sourceType(),
      },
      (candidatePostId) => this.findRenderedPostElement(candidatePostId)
    );
  }

  followCreatedPost(postId: string): void {
    const normalizedPostId = postId.trim();
    if (!normalizedPostId) return;

    this.pendingOwnPostFollowId.set(normalizedPostId);
    this.realtimeHydrationRequests$.next(normalizedPostId);
  }

  @HostListener('document:pointerdown', ['$event'])
  onDocumentPointerDown(event: Event): void {
    dismissOpenCommunityFeedDetailsOutside(
      this.openableMenus(),
      event.target
    );
  }

  @HostListener('document:keydown.escape', ['$event'])
  onDocumentEscape(event?: KeyboardEvent): void {
    const dismissed = dismissOpenCommunityFeedDetailsOnEscape(
      this.openableMenus(),
      globalThis.document?.activeElement ?? null
    );
    if (dismissed) event?.preventDefault();
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

  private composerContext(): CommunityFeedComposerContext {
    return {
      communityId: this.communityId().trim(),
      view: this.view(),
      sourceType: this.sourceType(),
      canInteract: this.canInteract(),
    };
  }

  private openableMenus(): HTMLDetailsElement[] {
    const menus = this.postMenus().map((menu) => menu.nativeElement);
    const attachmentMenu = this.attachmentMenu()?.nativeElement;
    if (attachmentMenu) menus.push(attachmentMenu);
    return menus;
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

    const decimals = location.precision === 'precise' ? 6 : 2;
    const normalizedLatitudeValue = Number(latitude.toFixed(decimals));
    const normalizedLongitudeValue = Number(longitude.toFixed(decimals));
    const normalizedLatitude = Object.is(normalizedLatitudeValue, -0)
      ? 0
      : normalizedLatitudeValue;
    const normalizedLongitude = Object.is(normalizedLongitudeValue, -0)
      ? 0
      : normalizedLongitudeValue;

    return {
      latitude: normalizedLatitude,
      longitude: normalizedLongitude,
      cacheKey: `${location.precision}:${normalizedLatitude.toFixed(decimals)},${normalizedLongitude.toFixed(decimals)}`,
    };
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
    changes: readonly CommunityFeedRealtimeChange[],
    communityId: string
  ): void {
    this.reactions.reconcileRealtime(changes, communityId);
    let commentMap: Map<string, number> | null = null;

    for (const change of changes) {
      const postId = change.projection.postId;
      const removed = change.type === 'removed'
        || change.projection.state === 'removed';

      if (removed) {
        if (this.commentCountOverrides().has(postId)) {
          commentMap ??= new Map(this.commentCountOverrides());
          commentMap.delete(postId);
        }
        continue;
      }

      if (this.commentCountOverrides().has(postId)) {
        commentMap ??= new Map(this.commentCountOverrides());
        commentMap.set(postId, change.projection.metrics.commentCount);
      }
    }

    if (commentMap) this.commentCountOverrides.set(commentMap);
  }

  private clearItemOverrides(postId: string): void {
    this.reactions.clearItem(postId, this.communityId().trim());
    if (this.commentCountOverrides().has(postId)) {
      const next = new Map(this.commentCountOverrides());
      next.delete(postId);
      this.commentCountOverrides.set(next);
    }
    if (this.replyPostId() === postId) {
      this.replyPostId.set(null);
    }
  }

  private createRequestId(): string {
    return createCommunityFeedRequestId();
  }

  private actionRequestKey(postId: string, action: CommunityFeedPostAction): string {
    return `${action}:${postId}`;
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
    this.applicationError.report(error, {
      feature: 'community',
      operation: 'moderatePost',
      fallbackMessage: action === 'delete_own'
        ? 'Não foi possível excluir a mensagem agora.'
        : 'Não foi possível remover a mensagem agora.',
      reasonMessages: COMMUNITY_FEED_POST_REASON_MESSAGES,
      codeMessages: COMMUNITY_FEED_POST_ACTION_CODE_MESSAGES,
      metadata: {
        scope: 'CommunityFeedComponent',
        action,
        view: this.view(),
        sourceType: this.sourceType(),
      },
    });
  }

  private reportLoadError(error: unknown, view: CommunityFeedView): void {
    const fallbackMessage = view === 'photos'
      ? 'Não foi possível carregar as fotos agora.'
      : this.sourceType() === 'venue'
        ? 'Não foi possível carregar as novidades do Local agora.'
        : 'Não foi possível carregar o mural da Comunidade agora.';

    this.applicationError.report(error, {
      feature: 'community',
      operation: 'loadPage',
      fallbackMessage,
      notification: 'none',
      metadata: {
        scope: 'CommunityFeedComponent',
        view,
        sourceType: this.sourceType(),
      },
    });
  }

  private reportTechnicalError(
    error: unknown,
    op:
      | 'loadPage'
      | 'moderatePost'
      | 'watchRealtime'
      | 'hydrateRealtimeItem',
    view: CommunityFeedView = this.view()
  ): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation: op,
      fallbackMessage: 'Não foi possível concluir esta atualização agora.',
      notification: 'none',
      metadata: {
        scope: 'CommunityFeedComponent',
        view,
        sourceType: this.sourceType(),
      },
    });
  }
}
