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
  effect,
  inject,
  input,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule } from '@angular/forms';
import { SafeResourceUrl } from '@angular/platform-browser';
import {
  combineLatest,
  distinctUntilChanged,
  filter,
  map,
  shareReplay,
  startWith,
  Subject,
  switchMap,
  timer,
} from 'rxjs';

import { PublicUserIdentityComponent } from 'src/app/core/components/public-user-identity/public-user-identity.component';
import { ImageFallbackDirective } from 'src/app/shared/directives/image-fallback.directive';
import { ReportContentButtonComponent } from 'src/app/shared/components-globais/moderation-report/report-content-button/report-content-button.component';
import {
  COMMUNITY_FEED_RENDER_WINDOW_MAX_ITEMS,
  CommunityFeedItem,
  CommunityFeedPostAction,
  CommunityFeedView,
  DEFAULT_COMMUNITY_FEED_PAGE_SIZE,
} from '../data-access/community-feed.model';
import type { CommunityFeedRealtimeChange } from '../data-access/community-feed-realtime.model';
import { CommunityFeedCommentStateFacade } from './community-feed-comment-state.facade';
import { CommunityFeedCommentsComponent } from '../feed-comments/community-feed-comments.component';
import { CommunityHighlightCardComponent } from '../highlight/community-highlight-card.component';
import { CommunityHighlightMenuActionComponent } from '../highlight/community-highlight-menu-action.component';
import {
  CommunityPreviewSourceType,
  CommunityPreviewViewerRole,
} from '../data-access/community-preview.model';
import { CommunityCameraCaptureComponent } from './community-camera-capture.component';
import { getCommunitySocialSpaceAdapter } from '../presentation/community-social-space.adapter';
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
import { CommunityFeedLocationFacade } from './community-feed-location.facade';
import { CommunityFeedModerationFacade } from './community-feed-moderation.facade';
import {
  INITIAL_COMMUNITY_FEED_STATE,
  reduceCommunityFeedState,
} from './community-feed-state.model';
import { CommunityFeedTimelineFacade } from './community-feed-timeline.facade';
import { CommunityFeedTimeTickerService } from './community-feed-time-ticker.service';
import {
  formatCommunityFeedIso,
  formatCommunityFeedTime,
} from './community-feed-time.util';
import {
  buildCommunityBoundedRenderWindow,
  communityRenderWindowStartForIndex,
  communityTailRenderWindowStart,
  normalizeCommunityRenderWindowStart,
} from '../community-bounded-render-window.util';

export {
  INITIAL_COMMUNITY_FEED_STATE,
  reduceCommunityFeedState,
} from './community-feed-state.model';

const MAX_UNSEEN_NEW_POSTS = 99;

@Component({
  selector: 'app-community-feed',
  standalone: true,
  imports: [
    AsyncPipe,
    PublicUserIdentityComponent,
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
    CommunityFeedCommentStateFacade,
    CommunityFeedReactionFacade,
    CommunityFeedReferenceNavigationFacade,
    CommunityFeedTimelineFacade,
    CommunityFeedModerationFacade,
    CommunityFeedLocationFacade,
  ],
  templateUrl: './community-feed.component.html',
  styleUrls: [
    './community-feed.component.css',
    './community-feed.interactions.css',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityFeedComponent {
  private readonly timeTicker = inject(CommunityFeedTimeTickerService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly composer = inject(CommunityFeedComposerFacade);
  private readonly commentState = inject(CommunityFeedCommentStateFacade);
  private readonly reactions = inject(CommunityFeedReactionFacade);
  private readonly references = inject(CommunityFeedReferenceNavigationFacade);
  private readonly timeline = inject(CommunityFeedTimelineFacade);
  private readonly moderation = inject(CommunityFeedModerationFacade);
  private readonly location = inject(CommunityFeedLocationFacade);
  private readonly postHighlightRequests$ = new Subject<string>();
  private readonly postElements = viewChildren<ElementRef<HTMLElement>>('postElement');
  private readonly postMenus = viewChildren<ElementRef<HTMLDetailsElement>>('postMenu');
  private readonly attachmentMenu = viewChild<ElementRef<HTMLDetailsElement>>('attachmentMenu');
  private readonly renderWindowStart = signal(0);
  private lastWindowItems: readonly CommunityFeedItem[] = [];
  private followRenderWindowTail = false;
  private pendingRevealPostId: string | null = null;
  private pendingScrollAnchor: {
    readonly postId: string;
    readonly top: number;
  } | null = null;
  private readonly pendingOwnPostFollowId = signal<string | null>(null);
  private readonly unseenAnchorPostId = signal<string | null>(null);
  private pendingRealtimeFollowIntent: boolean | null = null;
  private lastExternalFocusKey: string | null = null;
  private lastObservedLatestPostId: string | null = null;
  readonly communityId = input<string>('');
  readonly view = input<CommunityFeedView>('feed');
  readonly sourceType = input<CommunityPreviewSourceType>('community');
  readonly canInteract = input<boolean>(false);
  readonly viewerRole = input<CommunityPreviewViewerRole | null>(null);
  readonly focusPostId = input<string | null>(null);
  readonly focusCommentId = input<string | null>(null);
  readonly composerExpanded = this.composer.composerExpanded;
  readonly selectedAttachment = this.composer.selectedAttachment;
  readonly uploadProgress = this.composer.uploadProgress;
  readonly locationCaptureState = this.composer.locationCaptureState;
  readonly actionPostId = this.moderation.actionPostId;
  readonly actionMode = this.moderation.actionMode;
  readonly commentsPostId = this.commentState.commentsPostId;
  readonly replyPostId = this.commentState.replyPostId;
  readonly postReplyRequestVersion = this.commentState.postReplyRequestVersion;
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
  readonly postForm = this.composer.postForm;
  readonly removalReason = this.moderation.removalReason;

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

  readonly state$ = this.timeline.connect({
    scope$: this.feedScope$,
    sourceType: () => this.sourceType(),
    hooks: {
      onRealtimeChanges: (changes, communityId) =>
        this.reconcileRealtimeOverrides(changes, communityId),
      captureRealtimeFollowIntent: () => {
        if (this.renderWindowStart() > 0) return false;

        const currentLatestPostId = this.orderedPostIds()[0] ?? null;
        return this.unseenNewPostCount() === 0
          && (currentLatestPostId
            ? this.isPostInsideFollowZone(currentLatestPostId)
            : true);
      },
      commitRealtimeFollowIntent: (shouldFollowLatest) => {
        this.pendingRealtimeFollowIntent =
          this.pendingRealtimeFollowIntent === null
            ? shouldFollowLatest
            : this.pendingRealtimeFollowIntent && shouldFollowLatest;
      },
      clearRealtimeFollowIntent: () => {
        this.pendingRealtimeFollowIntent = null;
      },
    },
  });

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

  private readonly externalFocusEffect = effect(() => {
    const communityId = this.communityId().trim();
    const postId = String(this.focusPostId() ?? '').trim();
    const commentId = String(this.focusCommentId() ?? '').trim();

    if (!postId) {
      this.lastExternalFocusKey = null;
      return;
    }

    if (!communityId || this.view() !== 'feed') return;

    const focusKey = `${communityId}:${postId}:${commentId}`;
    if (this.lastExternalFocusKey === focusKey) return;

    this.lastExternalFocusKey = focusKey;

    if (commentId) {
      this.commentsPostId.set(postId);
      this.replyPostId.set(null);
    }

    this.navigateToPost(postId);
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

  readonly postActionState$ = this.moderation.state$;

  readonly reactionState$ = this.reactions.reactionState$;

  constructor() {
    this.timeline.pageLoaded$
      .pipe(
        filter(({ request }) => request.append),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        this.followRenderWindowTail = true;
      });

    this.state$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((state) =>
        this.reconcileRenderWindow(state.items, state.loadingMore)
      );

    this.composer.postCreated$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => this.followCreatedPost(result.postId));

    this.references.referencedItem$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((item) => {
        this.pendingRevealPostId = item.postId;
        this.timeline.applyLocalEvent({
          type: 'reference',
          item,
        });
      });

    this.moderation.removedPost$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((postId) => {
        this.clearItemOverrides(postId);
        this.timeline.applyLocalEvent({
          type: 'realtime',
          upserts: [],
          metricPatches: [],
          removedIds: [postId],
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
    return this.location.mapEmbedUrl(item);
  }

  locationMapUrl(item: CommunityFeedItem): string {
    return this.location.mapUrl(item);
  }

  submitPostOnEnter(event: Event): void {
    this.composer.submitPostOnEnter(event, this.composerContext());
  }

  submitPost(): void {
    this.composer.submitPost(this.composerContext());
  }

  requestPostAction(
    item: CommunityFeedItem,
    action: CommunityFeedPostAction
  ): void {
    this.moderation.request(item, action);
  }

  cancelPostAction(): void {
    this.moderation.cancel();
  }

  confirmPostAction(item: CommunityFeedItem): void {
    this.moderation.confirm(item, {
      communityId: this.communityId().trim(),
      view: this.view(),
      sourceType: this.sourceType(),
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
    event.preventDefault();
    this.navigateToPost(postId);
  }

  private navigateToPost(postId: string): void {
    const normalizedPostId = postId.trim();
    const communityId = this.communityId().trim();

    if (!normalizedPostId || !communityId) return;

    const navigate = () =>
      this.references.navigate(
        normalizedPostId,
        {
          communityId,
          view: this.view(),
          sourceType: this.sourceType(),
        },
        (candidatePostId) => this.findRenderedPostElement(candidatePostId)
      );

    if (this.revealLoadedPost(normalizedPostId)) {
      this.runAfterRender(navigate);
      return;
    }

    navigate();
  }

  followCreatedPost(postId: string): void {
    const normalizedPostId = postId.trim();
    if (!normalizedPostId) return;

    this.pendingOwnPostFollowId.set(normalizedPostId);
    this.pendingRevealPostId = normalizedPostId;
    this.timeline.hydratePost(normalizedPostId);
  }

  @HostListener('document:pointerdown', ['$event'])
  onDocumentPointerDown(event: Event): void {
    dismissOpenCommunityFeedDetailsOutside(
      this.openableMenus(),
      event.target
    );
  }

  @HostListener('document:keydown.escape', ['$event'])
  onDocumentEscape(event?: Event): void {
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
    this.followRenderWindowTail = false;
    this.renderWindowStart.set(0);
    this.clearUnseenNewPosts();

    this.runAfterRender(() => {
      if (latestPostId) this.postHighlightRequests$.next(latestPostId);
      this.scrollToLatestPost('start');
    });
  }

  newPostsLabel(): string {
    const count = this.unseenNewPostCount();
    return count === 1
      ? '1 nova publicação'
      : `${count} novas publicações`;
  }

  toggleComments(item: CommunityFeedItem): void {
    this.commentState.toggle(item);
  }

  openCommentsForReply(item: CommunityFeedItem): void {
    this.commentState.openForReply(item);
  }

  clearPostReplyContext(item: CommunityFeedItem): void {
    this.commentState.clearReplyContext(item);
  }

  commentsOpen(item: CommunityFeedItem): boolean {
    return this.commentState.commentsOpen(item);
  }

  commentCount(item: CommunityFeedItem): number {
    return this.commentState.commentCount(item);
  }

  updateCommentCount(item: CommunityFeedItem, commentCount: number): void {
    this.commentState.updateCommentCount(item, commentCount);
  }

  loadMore(cursor: string | null): void {
    if (!cursor) return;
    this.captureScrollAnchor();
    this.timeline.loadMore(cursor);
  }

  feedRenderWindow(items: readonly CommunityFeedItem[]) {
    return buildCommunityBoundedRenderWindow(
      items,
      COMMUNITY_FEED_RENDER_WINDOW_MAX_ITEMS,
      this.renderWindowStart()
    );
  }

  showNewerLoadedPosts(items: readonly CommunityFeedItem[]): void {
    this.shiftRenderWindow(items, -DEFAULT_COMMUNITY_FEED_PAGE_SIZE);
  }

  showOlderLoadedPosts(items: readonly CommunityFeedItem[]): void {
    this.shiftRenderWindow(items, DEFAULT_COMMUNITY_FEED_PAGE_SIZE);
  }

  retry(): void {
    this.timeline.retry();
  }

  composerPlaceholder(): string {
    return this.socialSpace().feed(this.view()).composerPlaceholder;
  }

  supportsHighlights(): boolean {
    return this.socialSpace().capabilities.highlights;
  }

  sectionAriaLabel(): string {
    return this.socialSpace().feed(this.view()).ariaLabel;
  }

  loadingLabel(): string {
    return this.socialSpace().feed(this.view()).loadingLabel;
  }

  errorStateLabel(): string {
    return this.socialSpace().feed(this.view()).errorLabel;
  }

  emptyLabel(): string {
    return this.socialSpace().feed(this.view()).emptyLabel;
  }

  publishedIso(publishedAt: number): string {
    return formatCommunityFeedIso(publishedAt);
  }

  publishedLabel(publishedAt: number): string {
    return formatCommunityFeedTime(publishedAt, this.now());
  }

  private socialSpace() {
    return getCommunitySocialSpaceAdapter(this.sourceType());
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



  private findRenderedPostElement(postId: string): ElementRef<HTMLElement> | null {
    return this.postElements().find(
      (element) => element.nativeElement.dataset['postId'] === postId
    ) ?? null;
  }

  private isPostInsideFollowZone(postId: string): boolean {
    const element = this.findRenderedPostElement(postId)?.nativeElement;
    if (!element) return false;
    if (typeof window === 'undefined') return true;

    const rect = element.getBoundingClientRect();
    const viewportHeight = window.innerHeight
      || globalThis.document?.documentElement?.clientHeight
      || 0;
    if (viewportHeight <= 0) return true;

    // A decisão é capturada antes da hidratação do novo item. Assim uma foto ou
    // mensagem longa não muda retroativamente a intenção de acompanhar o topo.
    return rect.bottom >= 0 && rect.top <= viewportHeight * 0.55;
  }

  private reconcileRenderWindow(
    items: readonly CommunityFeedItem[],
    loadingMore: boolean
  ): void {
    const previousFirstId =
      this.lastWindowItems[this.renderWindowStart()]?.postId ?? null;
    let nextStart = this.renderWindowStart();

    if (this.pendingRevealPostId) {
      const revealIndex = items.findIndex(
        (item) => item.postId === this.pendingRevealPostId
      );
      if (revealIndex >= 0) {
        nextStart = communityRenderWindowStartForIndex(
          items.length,
          COMMUNITY_FEED_RENDER_WINDOW_MAX_ITEMS,
          revealIndex
        );
        this.pendingRevealPostId = null;
        this.followRenderWindowTail = false;
      }
    } else if (this.followRenderWindowTail) {
      nextStart = communityTailRenderWindowStart(
        items.length,
        COMMUNITY_FEED_RENDER_WINDOW_MAX_ITEMS
      );
      this.followRenderWindowTail = false;
    } else if (previousFirstId) {
      const anchoredIndex = items.findIndex(
        (item) => item.postId === previousFirstId
      );
      nextStart = anchoredIndex >= 0
        ? normalizeCommunityRenderWindowStart(
            items.length,
            COMMUNITY_FEED_RENDER_WINDOW_MAX_ITEMS,
            anchoredIndex
          )
        : normalizeCommunityRenderWindowStart(
            items.length,
            COMMUNITY_FEED_RENDER_WINDOW_MAX_ITEMS,
            nextStart
          );
    } else {
      nextStart = normalizeCommunityRenderWindowStart(
        items.length,
        COMMUNITY_FEED_RENDER_WINDOW_MAX_ITEMS,
        nextStart
      );
    }

    this.lastWindowItems = items;

    if (nextStart !== this.renderWindowStart()) {
      this.renderWindowStart.set(nextStart);
    }

    if (!loadingMore && this.pendingScrollAnchor) {
      this.restoreScrollAnchor();
    }
  }

  private shiftRenderWindow(
    items: readonly CommunityFeedItem[],
    delta: number
  ): void {
    if (items.length <= COMMUNITY_FEED_RENDER_WINDOW_MAX_ITEMS) return;

    this.captureScrollAnchor();
    this.followRenderWindowTail = false;
    this.renderWindowStart.set(
      normalizeCommunityRenderWindowStart(
        items.length,
        COMMUNITY_FEED_RENDER_WINDOW_MAX_ITEMS,
        this.renderWindowStart() + delta
      )
    );
    this.restoreScrollAnchor();
  }

  private revealLoadedPost(postId: string): boolean {
    if (this.findRenderedPostElement(postId)) return false;

    const index = this.lastWindowItems.findIndex(
      (item) => item.postId === postId
    );
    if (index < 0) return false;

    this.followRenderWindowTail = false;
    this.renderWindowStart.set(
      communityRenderWindowStartForIndex(
        this.lastWindowItems.length,
        COMMUNITY_FEED_RENDER_WINDOW_MAX_ITEMS,
        index
      )
    );
    return true;
  }

  private captureScrollAnchor(): void {
    const elements = this.postElements();
    if (elements.length === 0) {
      this.pendingScrollAnchor = null;
      return;
    }

    const candidate =
      elements[Math.floor(elements.length / 2)]?.nativeElement ?? null;
    const postId = candidate?.dataset['postId']?.trim() ?? '';

    if (!candidate || !postId) {
      this.pendingScrollAnchor = null;
      return;
    }

    this.pendingScrollAnchor = {
      postId,
      top: candidate.getBoundingClientRect().top,
    };
  }

  private restoreScrollAnchor(): void {
    const anchor = this.pendingScrollAnchor;
    this.pendingScrollAnchor = null;
    if (!anchor) return;

    this.runAfterRender(() => {
      const target = this.findRenderedPostElement(anchor.postId)?.nativeElement;
      if (
        !target
        || typeof window === 'undefined'
        || typeof window.scrollBy !== 'function'
      ) {
        return;
      }

      const delta = target.getBoundingClientRect().top - anchor.top;
      if (Math.abs(delta) > 0.5) {
        window.scrollBy(0, delta);
      }
    });
  }

  private runAfterRender(callback: () => void): void {
    queueMicrotask(() => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => callback());
      } else {
        callback();
      }
    });
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



  private reconcileRealtimeOverrides(
    changes: readonly CommunityFeedRealtimeChange[],
    communityId: string
  ): void {
    this.reactions.reconcileRealtime(changes, communityId);
    this.commentState.reconcileRealtime(changes);
  }

  private clearItemOverrides(postId: string): void {
    this.reactions.clearItem(postId, this.communityId().trim());
    this.commentState.clearItem(postId);
  }


}
