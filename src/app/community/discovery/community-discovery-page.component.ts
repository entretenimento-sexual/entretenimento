// src/app/community/discovery/community-discovery-page.component.ts
import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChildren,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  Router,
  RouterLink,
  RouterLinkActive,
} from '@angular/router';
import {
  catchError,
  combineLatest,
  distinctUntilChanged,
  filter,
  finalize,
  map,
  Observable,
  of,
  shareReplay,
  startWith,
  Subject,
  switchMap,
} from 'rxjs';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import type { PreferenceProfile } from 'src/app/preferences/models/preference-profile.model';
import { ProfilePreferencesService } from 'src/app/preferences/services/profile-preferences.service';
import { ImageFallbackDirective } from 'src/app/shared/directives/image-fallback.directive';
import { CommunityCreationGateService } from '../community-create/community-creation-gate.service';
import type {
  CommunitySponsoredPlacement,
} from '../data-access/community-boost.model';
import {
  CommunityPreviewCard,
  CommunityPreviewSourceType,
} from '../data-access/community-preview.model';
import {
  CommunityTagCategory,
  CommunityTagDefinition,
  normalizeCommunityTagId,
} from '../data-access/community-tag.model';
import { CommunityTagRepository } from '../data-access/community-tag.repository';
import { CommunityOfficialBadgeComponent } from '../presentation/community-official-badge.component';
import {
  getCommunitySocialSpaceAdapter,
  normalizeCommunitySocialSpaceSourceType,
} from '../presentation/community-social-space.adapter';
import {
  resolveCommunityMembershipRolePresentation,
} from '../presentation/community-ui.presentation';
import {
  communityInitials as buildCommunityInitials,
  communityVisualVariant as resolveCommunityVisualVariant,
} from '../presentation/community-visual-identity';
import { CommunityDiscoveryMode } from './community-discovery-cache.model';
import {
  CommunityDiscoveryDataFacade,
  CommunityDiscoveryState,
} from './community-discovery-data.facade';
import {
  communityContextualMatchLabel,
  personalizeCommunityDiscoveryCards,
} from './community-contextual-relevance';
import { CommunityDiscoveryExposureService } from './community-discovery-exposure.service';
import { CommunityDiscoverySessionBehaviorService } from './community-discovery-session-behavior.service';
import { CommunityDiscoveryVisibilityDirective } from './community-discovery-visibility.directive';
import {
  CommunityDiscoveryMineCardView,
  CommunityDiscoveryMineFacade,
} from './community-discovery-mine.facade';
import { CommunityDiscoverySponsoredFacade } from './community-discovery-sponsored.facade';
import { CommunityDiscoveryRenderWindowFacade } from './community-discovery-render-window.facade';
import {
  shouldShowMineCommunitySearch,
} from './community-mine-participation.policy';

type CommunityTagFilterState =
  | { status: 'loading'; items: readonly CommunityTagDefinition[] }
  | { status: 'ready'; items: readonly CommunityTagDefinition[] }
  | { status: 'error'; items: readonly CommunityTagDefinition[] };

type CommunityDiscoveryCardView = CommunityDiscoveryMineCardView;

interface CommunityDiscoveryViewState {
  status: CommunityDiscoveryState['status'];
  items: readonly CommunityDiscoveryCardView[];
  nextCursor: string | null;
  loadingMore: boolean;
  mineLoadedItemCount: number;
  mineSearchVisible: boolean;
  mineControlsActive: boolean;
  mineWindowKey: string;
}

interface HiddenCommunityFeedback {
  readonly communityId: string;
  readonly name: string;
}

const COMMUNITY_QUICK_FILTER_TAG_IDS = Object.freeze([
  'intent:friendship',
  'intent:casual',
  'intent:dating',
  'intent:swing',
  'practice:bdsm',
  'practice:fetishes',
] as const);
const COMMUNITY_QUICK_FILTER_TAG_ID_SET = new Set<string>(
  COMMUNITY_QUICK_FILTER_TAG_IDS
);

@Component({
  selector: 'app-community-discovery-page',
  standalone: true,
  imports: [
    AsyncPipe,
    RouterLink,
    RouterLinkActive,
    ImageFallbackDirective,
    CommunityOfficialBadgeComponent,
    CommunityDiscoveryVisibilityDirective,
  ],
  providers: [
    CommunityDiscoveryDataFacade,
    CommunityDiscoveryMineFacade,
    CommunityDiscoverySponsoredFacade,
    CommunityDiscoveryRenderWindowFacade,
  ],
  templateUrl: './community-discovery-page.component.html',
  styleUrl: './community-discovery-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityDiscoveryPageComponent {
  private readonly tagRepository = inject(CommunityTagRepository);
  private readonly creationGate = inject(CommunityCreationGateService);
  private readonly exposureService = inject(CommunityDiscoveryExposureService);
  private readonly sessionBehavior = inject(
    CommunityDiscoverySessionBehaviorService
  );
  private readonly authSession = inject(AuthSessionService);
  private readonly profilePreferences = inject(ProfilePreferencesService);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dataFacade = inject(CommunityDiscoveryDataFacade);
  readonly mineFacade = inject(CommunityDiscoveryMineFacade);
  private readonly sponsoredFacade = inject(CommunityDiscoverySponsoredFacade);
  private readonly renderWindow = inject(CommunityDiscoveryRenderWindowFacade);
  private readonly tagCatalogReload$ = new Subject<void>();
  private readonly discoveryCardElements =
    viewChildren<ElementRef<HTMLElement>>('discoveryCardShell');

  readonly sourceType: CommunityPreviewSourceType =
    normalizeCommunitySocialSpaceSourceType(
      this.route.snapshot.data['sourceType']
    );
  private readonly socialSpace =
    getCommunitySocialSpaceAdapter(this.sourceType);
  readonly definition = this.socialSpace.definition;
  readonly discoveryMode: CommunityDiscoveryMode =
    this.socialSpace.capabilities.personalMembershipHub
    && this.route.snapshot.data['discoveryMode'] === 'mine'
      ? 'mine'
      : 'explore';
  readonly title = this.discoveryMode === 'mine'
    ? 'Minhas comunidades'
    : this.definition.pluralLabel;
  readonly hubTitle = this.socialSpace.discovery.hubTitle;
  readonly description = this.discoveryMode === 'mine'
    ? 'Comunidades das quais você participa ou administra.'
    : this.definition.description;
  readonly emptyMessage = this.discoveryMode === 'mine'
    ? 'Você ainda não participa de nenhuma Comunidade.'
    : this.socialSpace.discovery.emptyExploreMessage;
  readonly canCreateVenue = this.socialSpace.discovery.canCreateVenue;
  readonly canCreateCommunity = this.socialSpace.discovery.canCreateCommunity;
  readonly showCommunityNavigation =
    this.socialSpace.capabilities.personalMembershipHub;
  readonly canFilterByTags =
    this.socialSpace.capabilities.interestDiscovery
    && this.discoveryMode === 'explore';

  private readonly initialTagId = this.canFilterByTags
    ? normalizeCommunityTagId(
        this.route.snapshot.queryParamMap?.get('interesse')
      )
    : null;

  private readonly mineUnreadSummaryMap$ =
    this.mineFacade.unreadSummaryMap$(this.discoveryMode === 'mine');

  private readonly mineMutedCommunityIds$ =
    this.mineFacade.mutedCommunityIds$(this.discoveryMode === 'mine');

  readonly selectedTagId = signal<string | null>(this.initialTagId);
  readonly sponsoredPlacement = this.sponsoredFacade.sponsoredPlacement;
  readonly creationGateBusy = signal(false);
  readonly hiddenCommunityFeedback = signal<HiddenCommunityFeedback | null>(null);

  readonly tagFilterState$: Observable<CommunityTagFilterState> =
    this.tagCatalogReload$.pipe(
      startWith(undefined),
      switchMap(() => {
        if (!this.canFilterByTags) {
          return of<CommunityTagFilterState>({ status: 'ready', items: [] });
        }

        return this.tagRepository.getCommunityTagCatalog$().pipe(
          map((catalog): CommunityTagFilterState => ({
            status: 'ready',
            items: catalog.items,
          })),
          catchError((error: unknown) => {
            this.reportTagCatalogError(error);
            return of<CommunityTagFilterState>({ status: 'error', items: [] });
          }),
          startWith<CommunityTagFilterState>({ status: 'loading', items: [] })
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  private readonly contextualPreferenceProfile$: Observable<PreferenceProfile | null> =
    this.canFilterByTags
      ? this.authSession.uid$.pipe(
          map((uid) => String(uid ?? '').trim()),
          distinctUntilChanged(),
          switchMap((uid) =>
            uid
              ? this.profilePreferences.getProfile$(uid).pipe(
                  map((profile): PreferenceProfile | null => profile)
                )
              : of<PreferenceProfile | null>(null)
          ),
          shareReplay({ bufferSize: 1, refCount: true })
        )
      : of(null);

  readonly state$ = this.dataFacade.connect({
    sourceType: this.sourceType,
    discoveryMode: this.discoveryMode,
    canFilterByTags: this.canFilterByTags,
    title: this.title,
    initialTagId: this.initialTagId,
  });

  readonly viewState$: Observable<CommunityDiscoveryViewState> = combineLatest([
    this.state$,
    this.tagFilterState$,
    this.contextualPreferenceProfile$,
    this.sessionBehavior.state$,
    this.mineUnreadSummaryMap$,
    this.mineMutedCommunityIds$,
    this.mineFacade.searchTerm$,
    this.mineFacade.participationFilter$,
  ]).pipe(
    map(([
      state,
      tagState,
      profile,
      sessionBehavior,
      unreadSummaryMap,
      mutedCommunityIds,
      mineSearchTerm,
      mineParticipationFilter,
    ]): CommunityDiscoveryViewState => {
      let status = state.status;
      let items = state.items;

      if (
        this.canFilterByTags
        && state.status === 'ready'
        && tagState.status === 'ready'
      ) {
        items = personalizeCommunityDiscoveryCards(
          state.items,
          tagState.items,
          profile,
          sessionBehavior
        );
        status = items.length > 0 ? 'ready' : 'empty';
      }

      const cardViews = this.mineFacade.decorateCards(
        items,
        unreadSummaryMap,
        mutedCommunityIds
      );

      if (this.discoveryMode !== 'mine') {
        return {
          ...state,
          status,
          items: cardViews,
          mineLoadedItemCount: 0,
          mineSearchVisible: false,
          mineControlsActive: false,
          mineWindowKey: '',
        };
      }

      return {
        ...state,
        status,
        items: this.mineFacade.filterAndOrder(
          cardViews,
          mineParticipationFilter,
          mineSearchTerm
        ),
        mineLoadedItemCount: cardViews.length,
        mineSearchVisible: shouldShowMineCommunitySearch(
          cardViews.length,
          mineSearchTerm
        ),
        mineControlsActive:
          mineParticipationFilter !== 'all'
          || mineSearchTerm.trim().length > 0,
        mineWindowKey:
          `${mineParticipationFilter}|${mineSearchTerm.trim().toLocaleLowerCase('pt-BR')}`,
      };
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor() {
    this.dataFacade.pageLoaded$
      .pipe(
        filter(({ request }) => !request.append),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ request, page }) =>
        this.sponsoredFacade.loadForPage(
          page.items,
          this.sponsoredContext(request.tagId)
        )
      );

    this.dataFacade.pageLoaded$
      .pipe(
        filter(({ request }) => request.append),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.renderWindow.markAppendLoaded());

    this.viewState$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((state) =>
        this.renderWindow.reconcile(state.items, {
          mineMode: this.discoveryMode === 'mine',
          mineWindowKey: state.mineWindowKey,
          loadingMore: state.loadingMore,
          resolveElements: () => this.discoveryCardElements(),
        })
      );

    this.route.queryParamMap
      .pipe(
        map((params) =>
          this.canFilterByTags
            ? normalizeCommunityTagId(params.get('interesse'))
            : null
        ),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((tagId) => this.applyTagFilter(tagId, false));

  }

  requestCommunityCreation(event?: Event): void {
    event?.preventDefault();
    if (!this.canCreateCommunity || this.creationGateBusy()) return;

    this.creationGateBusy.set(true);
    this.creationGate.requestCreation$().pipe(
      finalize(() => this.creationGateBusy.set(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  loadMore(cursor: string | null): void {
    if (!cursor) return;
    this.renderWindow.prepareLoadMore(() => this.discoveryCardElements());
    this.dataFacade.loadMore(cursor, this.selectedTagId());
  }

  discoveryRenderWindow(items: readonly CommunityDiscoveryCardView[]) {
    return this.renderWindow.window(items);
  }

  showPreviousLoadedResults(
    items: readonly CommunityDiscoveryCardView[]
  ): void {
    this.renderWindow.showPreviousLoaded(
      items,
      () => this.discoveryCardElements()
    );
  }

  showNextLoadedResults(
    items: readonly CommunityDiscoveryCardView[]
  ): void {
    this.renderWindow.showNextLoaded(
      items,
      () => this.discoveryCardElements()
    );
  }

  retry(): void {
    this.renderWindow.reset();
    this.sponsoredFacade.reset();
    this.dataFacade.reload(this.selectedTagId());
  }

  retryTagCatalog(): void {
    this.tagCatalogReload$.next();
  }

  recordQualifiedExposure(communityId: string): void {
    if (this.discoveryMode !== 'explore') return;
    this.exposureService.recordQualifiedExposure(communityId, this.sourceType);
  }

  recordSponsoredQualifiedExposure(
    placement: CommunitySponsoredPlacement
  ): void {
    this.sponsoredFacade.recordQualifiedExposure(
      placement,
      this.sponsoredContext(this.selectedTagId())
    );
  }

  recordSponsoredClick(placement: CommunitySponsoredPlacement): void {
    this.sponsoredFacade.recordClick(
      placement,
      this.sponsoredContext(this.selectedTagId())
    );
  }

  hideSponsoredCommunity(
    placement: CommunitySponsoredPlacement,
    event: Event
  ): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.discoveryMode !== 'explore') return;

    const communityId = String(
      placement.community.communityId ?? ''
    ).trim();
    if (!communityId) return;

    this.sessionBehavior.hideCommunity(communityId);
    this.sponsoredFacade.dismiss(
      placement,
      this.sponsoredContext(this.selectedTagId())
    );
    this.hiddenCommunityFeedback.set({
      communityId,
      name: placement.community.name,
    });
  }

  sponsoredPlacementAfter(
    itemIndex: number,
    organicCardCount: number
  ): CommunitySponsoredPlacement | null {
    return this.sponsoredFacade.placementAfter(itemIndex, organicCardCount);
  }

  selectTagFilter(tagId: string | null): void {
    this.applyTagFilter(normalizeCommunityTagId(tagId), true);
  }

  changeTagFilter(event: Event): void {
    const target = event.target;
    const rawValue = target instanceof HTMLSelectElement ? target.value : '';
    this.applyTagFilter(normalizeCommunityTagId(rawValue), true);
  }

  hideCommunity(item: CommunityPreviewCard, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.canFilterByTags) return;

    this.sessionBehavior.hideCommunity(item.communityId);
    this.hiddenCommunityFeedback.set({
      communityId: item.communityId,
      name: item.name,
    });
  }

  restoreHiddenCommunity(): void {
    const feedback = this.hiddenCommunityFeedback();
    if (!feedback) return;

    this.sessionBehavior.restoreCommunity(feedback.communityId);
    this.hiddenCommunityFeedback.set(null);
  }

  quickFilterTags(
    items: readonly CommunityTagDefinition[]
  ): readonly CommunityTagDefinition[] {
    const catalog = new Map(items.map((tag) => [tag.id, tag] as const));

    return COMMUNITY_QUICK_FILTER_TAG_IDS
      .map((id) => catalog.get(id) ?? null)
      .filter((tag): tag is CommunityTagDefinition => tag !== null);
  }

  moreInterestSelectValue(): string {
    const selected = this.selectedTagId();
    return selected && !COMMUNITY_QUICK_FILTER_TAG_ID_SET.has(selected)
      ? selected
      : '';
  }

  tagsForCategory(
    items: readonly CommunityTagDefinition[],
    category: CommunityTagCategory
  ): readonly CommunityTagDefinition[] {
    return items.filter((tag) => tag.category === category);
  }

  tagCategoryLabel(category: CommunityTagCategory): string {
    if (category === 'intent') return 'Objetivos';
    if (category === 'practice') return 'Interesses';
    return 'Público e afinidades';
  }

  sourceLabel(item: CommunityPreviewCard): string {
    return getCommunitySocialSpaceAdapter(item.source.type).definition.label;
  }

  communityInitials(item: CommunityPreviewCard): string {
    return buildCommunityInitials(item);
  }

  communityVisualVariant(item: CommunityPreviewCard): number {
    return resolveCommunityVisualVariant(item);
  }

  contextualMatchLabel(item: CommunityPreviewCard): string | null {
    return this.canFilterByTags
      ? communityContextualMatchLabel(item)
      : null;
  }

  membershipRolePresentation(item: CommunityPreviewCard) {
    return this.discoveryMode === 'mine'
      ? resolveCommunityMembershipRolePresentation(
          item.viewerRole,
          item.source.type
        )
      : null;
  }

  toggleCommunityNotifications(item: CommunityDiscoveryCardView): void {
    if (this.discoveryMode !== 'mine') return;
    this.mineFacade.toggleNotifications(
      item,
      this.errorMetadata(),
      this.discoveryMode === 'mine'
    );
  }

  detailsRoute(item: CommunityPreviewCard): readonly string[] {
    return getCommunitySocialSpaceAdapter(
      item.source.type
    ).discovery.detailsRoute(item.communityId, this.discoveryMode);
  }

  returnTarget(item: CommunityPreviewCard): string {
    return getCommunitySocialSpaceAdapter(
      item.source.type
    ).discovery.returnTarget(this.discoveryMode, this.selectedTagId());
  }

  showKindBadge(item: CommunityPreviewCard): boolean {
    return getCommunitySocialSpaceAdapter(item.source.type).showKindBadge;
  }

  private applyTagFilter(tagId: string | null, syncUrl: boolean): void {
    if (!this.canFilterByTags || tagId === this.selectedTagId()) return;

    this.selectedTagId.set(tagId);
    this.renderWindow.reset();
    this.sponsoredFacade.reset();
    this.dataFacade.reload(tagId);

    if (!syncUrl) return;

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { interesse: tagId },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private reportTagCatalogError(error: unknown): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation: 'getCommunityTagCatalog',
      fallbackMessage:
        'Os filtros por interesse não puderam ser carregados agora.',
      notification: 'warning',
      metadata: this.errorMetadata(),
    });
  }

  private sponsoredContext(tagId: string | null) {
    return {
      sourceType: this.sourceType,
      canFilterByTags: this.canFilterByTags,
      tagId,
      discoveryMode: this.discoveryMode,
    } as const;
  }

  private errorMetadata(): Readonly<Record<string, unknown>> {
    return {
      scope: 'CommunityDiscoveryPageComponent',
      sourceType: this.sourceType,
      discoveryMode: this.discoveryMode,
      tagId: this.selectedTagId(),
    };
  }
}
