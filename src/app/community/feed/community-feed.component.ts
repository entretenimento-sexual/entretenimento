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
  CommunityFeedItem,
  CommunityFeedPostAction,
  CommunityFeedView,
} from '../data-access/community-feed.model';
import type { CommunityFeedRealtimeChange } from '../data-access/community-feed-realtime.model';
import { CommunityFeedCommentsComponent } from '../feed-comments/community-feed-comments.component';
import { CommunityHighlightCardComponent } from '../highlight/community-highlight-card.component';
import { CommunityHighlightMenuActionComponent } from '../highlight/community-highlight-menu-action.component';
import {
  CommunityPreviewSourceType,
  CommunityPreviewViewerRole,
} from '../data-access/community-preview.model';
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
  private readonly reactions = inject(CommunityFeedReactionFacade);
  private readonly references = inject(CommunityFeedReferenceNavigationFacade);
  private readonly timeline = inject(CommunityFeedTimelineFacade);
  private readonly moderation = inject(CommunityFeedModerationFacade);
  private readonly location = inject(CommunityFeedLocationFacade);
  private readonly postHighlightRequests$ = new Subject<string>();
  private readonly postElements = viewChildren<ElementRef<HTMLElement>>('postElement');
  private readonly postMenus = viewChildren<ElementRef<HTMLDetailsElement>>('postMenu');
  private readonly attachmentMenu = viewChild<ElementRef<HTMLDetailsElement>>('attachmentMenu');
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
    this.composer.postCreated$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => this.followCreatedPost(result.postId));

    this.references.referencedItem$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((item) => {
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

    this.references.navigate(
      normalizedPostId,
      {
        communityId,
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
    this.timeline.loadMore(cursor);
  }

  retry(): void {
    this.timeline.retry();
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


}
