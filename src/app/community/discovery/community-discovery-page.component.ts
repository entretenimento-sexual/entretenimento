// src/app/community/discovery/community-discovery-page.component.ts
import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
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
  concat,
  distinctUntilChanged,
  filter,
  finalize,
  map,
  Observable,
  of,
  scan,
  shareReplay,
  startWith,
  Subject,
  switchMap,
  tap,
} from 'rxjs';

import { getSocialSpaceDefinition } from 'src/app/core/domain/social-space.definition';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import type { PreferenceProfile } from 'src/app/preferences/models/preference-profile.model';
import { ProfilePreferencesService } from 'src/app/preferences/services/profile-preferences.service';
import { ImageFallbackDirective } from 'src/app/shared/directives/image-fallback.directive';
import { CommunityCreationGateService } from '../community-create/community-creation-gate.service';
import { CommunityMembershipRepository } from '../data-access/community-membership.repository';
import {
  CommunityDiscoveryPage,
  CommunityPreviewCard,
  CommunityPreviewSourceType,
  CommunityPreviewViewerRole,
} from '../data-access/community-preview.model';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';
import {
  CommunityTagCategory,
  CommunityTagDefinition,
  normalizeCommunityTagId,
} from '../data-access/community-tag.model';
import { CommunityTagRepository } from '../data-access/community-tag.repository';
import { CommunityOfficialBadgeComponent } from '../presentation/community-official-badge.component';
import {
  communityInitials as buildCommunityInitials,
  communityVisualVariant as resolveCommunityVisualVariant,
} from '../presentation/community-visual-identity';
import {
  CommunityDiscoveryCacheContext,
  CommunityDiscoveryMode,
  DEFAULT_COMMUNITY_DISCOVERY_PAGE_SIZE,
} from './community-discovery-cache.model';
import { CommunityDiscoveryCacheService } from './community-discovery-cache.service';
import {
  communityContextualMatchLabel,
  personalizeCommunityDiscoveryCards,
} from './community-contextual-relevance';
import { CommunityDiscoverySessionBehaviorService } from './community-discovery-session-behavior.service';

type CommunityDiscoveryStatus = 'loading' | 'ready' | 'empty' | 'error';
type CommunityTagFilterState =
  | { status: 'loading'; items: readonly CommunityTagDefinition[] }
  | { status: 'ready'; items: readonly CommunityTagDefinition[] }
  | { status: 'error'; items: readonly CommunityTagDefinition[] };

interface CommunityDiscoveryState {
  status: CommunityDiscoveryStatus;
  items: readonly CommunityPreviewCard[];
  nextCursor: string | null;
  loadingMore: boolean;
}

interface LoadRequest {
  cursor: string | null;
  append: boolean;
  tagId: string | null;
}

interface HiddenCommunityFeedback {
  readonly communityId: string;
  readonly name: string;
}

type LoadEvent =
  | { type: 'loading'; request: LoadRequest }
  | { type: 'success'; request: LoadRequest; page: CommunityDiscoveryPage }
  | { type: 'error'; request: LoadRequest };

const INITIAL_STATE: CommunityDiscoveryState = Object.freeze({
  status: 'loading',
  items: [],
  nextCursor: null,
  loadingMore: false,
});

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

function mergeCards(
  current: readonly CommunityPreviewCard[],
  incoming: readonly CommunityPreviewCard[]
): readonly CommunityPreviewCard[] {
  const merged = new Map<string, CommunityPreviewCard>();

  for (const item of current) merged.set(item.communityId, item);
  for (const item of incoming) merged.set(item.communityId, item);

  return [...merged.values()];
}

function reduceState(
  state: CommunityDiscoveryState,
  event: LoadEvent
): CommunityDiscoveryState {
  if (event.type === 'loading') {
    return event.request.append
      ? { ...state, loadingMore: true }
      : INITIAL_STATE;
  }

  if (event.type === 'error') {
    if (state.items.length > 0) {
      return { ...state, loadingMore: false };
    }

    return {
      status: 'error',
      items: [],
      nextCursor: null,
      loadingMore: false,
    };
  }

  const items = event.request.append
    ? mergeCards(state.items, event.page.items)
    : event.page.items;

  return {
    status: items.length > 0 ? 'ready' : 'empty',
    items,
    nextCursor: event.page.nextCursor,
    loadingMore: false,
  };
}

@Component({
  selector: 'app-community-discovery-page',
  standalone: true,
  imports: [
    AsyncPipe,
    RouterLink,
    RouterLinkActive,
    ImageFallbackDirective,
    CommunityOfficialBadgeComponent,
  ],
  templateUrl: './community-discovery-page.component.html',
  styleUrl: './community-discovery-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityDiscoveryPageComponent {
  private readonly repository = inject(CommunityPreviewRepository);
  private readonly membershipRepository = inject(CommunityMembershipRepository);
  private readonly tagRepository = inject(CommunityTagRepository);
  private readonly creationGate = inject(CommunityCreationGateService);
  private readonly discoveryCache = inject(CommunityDiscoveryCacheService);
  private readonly sessionBehavior = inject(
    CommunityDiscoverySessionBehaviorService
  );
  private readonly authSession = inject(AuthSessionService);
  private readonly profilePreferences = inject(ProfilePreferencesService);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly loadRequests$ = new Subject<LoadRequest>();
  private readonly tagCatalogReload$ = new Subject<void>();
  private readonly membershipContextResolvedIds = new Set<string>();

  readonly sourceType: CommunityPreviewSourceType =
    this.route.snapshot.data['sourceType'] === 'venue' ? 'venue' : 'community';
  readonly discoveryMode: CommunityDiscoveryMode =
    this.sourceType === 'community'
    && this.route.snapshot.data['discoveryMode'] === 'mine'
      ? 'mine'
      : 'explore';
  readonly definition = getSocialSpaceDefinition(this.sourceType);
  readonly title = this.discoveryMode === 'mine'
    ? 'Minhas comunidades'
    : this.definition.pluralLabel;
  readonly hubTitle = this.sourceType === 'community'
    ? 'Comunidades'
    : this.title;
  readonly description = this.discoveryMode === 'mine'
    ? 'Comunidades das quais você participa ou administra.'
    : this.definition.description;
  readonly emptyMessage = this.sourceType === 'venue'
    ? 'Nenhum Local disponível.'
    : this.discoveryMode === 'mine'
      ? 'Você ainda não participa de nenhuma Comunidade.'
      : 'Ainda não há Comunidades por aqui.';
  readonly canCreateVenue = this.sourceType === 'venue';
  readonly canCreateCommunity = this.sourceType === 'community';
  readonly showCommunityNavigation = this.sourceType === 'community';
  readonly canFilterByTags =
    this.sourceType === 'community' && this.discoveryMode === 'explore';

  private readonly initialTagId = this.canFilterByTags
    ? normalizeCommunityTagId(
        this.route.snapshot.queryParamMap?.get('interesse')
      )
    : null;

  readonly selectedTagId = signal<string | null>(this.initialTagId);
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

  readonly state$ = this.loadRequests$.pipe(
    startWith<LoadRequest>({
      cursor: null,
      append: false,
      tagId: this.initialTagId,
    }),
    switchMap((request) =>
      this.resolveLoadEvents$(request).pipe(
        startWith<LoadEvent>({ type: 'loading', request }),
        catchError((error: unknown) => this.recoverLoadError$(error, request))
      )
    ),
    scan(reduceState, INITIAL_STATE),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly viewState$: Observable<CommunityDiscoveryState> = combineLatest([
    this.state$,
    this.tagFilterState$,
    this.contextualPreferenceProfile$,
    this.sessionBehavior.state$,
  ]).pipe(
    map(([state, tagState, profile, sessionBehavior]): CommunityDiscoveryState => {
      if (
        !this.canFilterByTags
        || state.status !== 'ready'
        || tagState.status !== 'ready'
      ) {
        return state;
      }

      const items = personalizeCommunityDiscoveryCards(
        state.items,
        tagState.items,
        profile,
        sessionBehavior
      );

      return {
        ...state,
        status: items.length > 0 ? 'ready' : 'empty',
        items,
      };
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor() {
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

    this.observeVisibleMembershipContext();
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

    this.loadRequests$.next({
      cursor,
      append: true,
      tagId: this.selectedTagId(),
    });
  }

  retry(): void {
    this.loadRequests$.next({
      cursor: null,
      append: false,
      tagId: this.selectedTagId(),
    });
  }

  retryTagCatalog(): void {
    this.tagCatalogReload$.next();
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
    return getSocialSpaceDefinition(item.source.type).label;
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

  membershipRoleLabel(item: CommunityPreviewCard): string | null {
    if (this.discoveryMode !== 'mine' || !item.viewerRole) return null;

    const labels: Record<CommunityPreviewViewerRole, string> = {
      owner: 'Proprietário',
      admin: 'Administração',
      moderator: 'Moderação',
      member: 'Membro',
    };

    return labels[item.viewerRole];
  }

  detailsRoute(item: CommunityPreviewCard): readonly string[] {
    if (item.source.type === 'venue') {
      return ['/dashboard/locais', item.communityId];
    }

    return this.discoveryMode === 'mine'
      ? ['/dashboard/comunidades/minhas', item.communityId]
      : ['/dashboard/comunidades', item.communityId];
  }

  private observeVisibleMembershipContext(): void {
    if (!this.canFilterByTags) return;

    this.state$.pipe(
      map((state) =>
        state.status === 'ready'
          ? [...new Set(
              state.items
                .map((item) => item.communityId)
                .filter((communityId) =>
                  !this.membershipContextResolvedIds.has(communityId)
                )
            )]
          : []
      ),
      filter((communityIds) => communityIds.length > 0),
      switchMap((communityIds) =>
        this.membershipRepository.getMembershipContext$(communityIds).pipe(
          map((context) => ({
            communityIds,
            activeCommunityIds: new Set(context.activeCommunityIds),
          })),
          catchError((error: unknown) => {
            this.reportMembershipContextError(error);
            return of(null);
          })
        )
      ),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((context) => {
      if (!context) return;

      for (const communityId of context.communityIds) {
        this.sessionBehavior.setMembershipActive(
          communityId,
          context.activeCommunityIds.has(communityId)
        );
        this.membershipContextResolvedIds.add(communityId);
      }
    });
  }

  private resolveLoadEvents$(request: LoadRequest): Observable<LoadEvent> {
    const context = this.cacheContext(request.tagId);

    if (request.append) {
      return this.fetchPageEvent$(request, context);
    }

    return this.discoveryCache.readSnapshot$(context).pipe(
      switchMap((snapshot) => {
        if (!snapshot) {
          return this.fetchPageEvent$(request, context);
        }

        const cached$ = of<LoadEvent>({
          type: 'success',
          request,
          page: snapshot.page,
        });

        return snapshot.fresh
          ? cached$
          : concat(cached$, this.fetchPageEvent$(request, context));
      })
    );
  }

  private fetchPageEvent$(
    request: LoadRequest,
    context: CommunityDiscoveryCacheContext
  ): Observable<LoadEvent> {
    const page$ = this.discoveryMode === 'mine'
      ? this.repository.getMyCommunitiesPage$({
          limit: DEFAULT_COMMUNITY_DISCOVERY_PAGE_SIZE,
          cursor: request.cursor,
          sourceType: 'community',
        })
      : this.repository.getDiscoveryPage$({
          limit: DEFAULT_COMMUNITY_DISCOVERY_PAGE_SIZE,
          cursor: request.cursor,
          sourceType: this.sourceType,
          tagId: this.canFilterByTags ? request.tagId : null,
        });

    return page$.pipe(
      tap((page) =>
        this.discoveryCache.rememberPage(context, page, request.append)
      ),
      map(
        (page): LoadEvent => ({
          type: 'success',
          request,
          page,
        })
      )
    );
  }

  private recoverLoadError$(
    error: unknown,
    request: LoadRequest
  ): Observable<LoadEvent> {
    const options = {
      feature: 'community',
      operation: 'loadDiscoveryPage',
      fallbackMessage:
        `Não foi possível carregar ${this.title.toLowerCase()}.`,
      metadata: this.errorMetadata(),
    } as const;
    const descriptor = this.applicationError.normalize(error, options);

    if (
      request.append
      && this.discoveryMode === 'explore'
      && descriptor.code === 'aborted'
    ) {
      this.applicationError.report(error, {
        ...options,
        notification: 'none',
      });
      const resetRequest: LoadRequest = {
        cursor: null,
        append: false,
        tagId: request.tagId,
      };

      return this.fetchPageEvent$(
        resetRequest,
        this.cacheContext(resetRequest.tagId)
      ).pipe(
        catchError((refreshError: unknown) => {
          this.reportError(refreshError);
          return of<LoadEvent>({ type: 'error', request });
        })
      );
    }

    this.applicationError.report(error, options);
    return of<LoadEvent>({ type: 'error', request });
  }

  private cacheContext(tagId: string | null): CommunityDiscoveryCacheContext {
    return {
      sourceType: this.sourceType,
      discoveryMode: this.discoveryMode,
      tagId: this.canFilterByTags ? tagId : null,
      pageSize: DEFAULT_COMMUNITY_DISCOVERY_PAGE_SIZE,
    };
  }

  private applyTagFilter(tagId: string | null, syncUrl: boolean): void {
    if (!this.canFilterByTags || tagId === this.selectedTagId()) return;

    this.selectedTagId.set(tagId);
    this.loadRequests$.next({ cursor: null, append: false, tagId });

    if (!syncUrl) return;

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { interesse: tagId },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private reportMembershipContextError(error: unknown): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation: 'getCommunityMembershipContext',
      fallbackMessage:
        'Não foi possível considerar suas participações na recomendação agora.',
      notification: 'none',
      metadata: this.errorMetadata(),
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

  private reportError(error: unknown): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation: 'loadDiscoveryPage',
      fallbackMessage:
        `Não foi possível carregar ${this.title.toLowerCase()}.`,
      metadata: this.errorMetadata(),
    });
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
