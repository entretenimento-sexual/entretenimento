// src/app/community/discovery/community-discovery-page.component.ts
import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import {
  takeUntilDestroyed,
  toObservable,
} from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  Router,
  RouterLink,
  RouterLinkActive,
} from '@angular/router';
import {
  catchError,
  distinctUntilChanged,
  EMPTY,
  finalize,
  map,
  Observable,
  of,
  shareReplay,
  startWith,
  Subject,
  switchMap,
  tap,
} from 'rxjs';

import { getSocialSpaceDefinition } from 'src/app/core/domain/social-space.definition';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ImageFallbackDirective } from 'src/app/shared/directives/image-fallback.directive';
import { CommunityCreationGateService } from '../community-create/community-creation-gate.service';
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

type CommunityTagFilterState =
  | { status: 'loading'; items: readonly CommunityTagDefinition[] }
  | { status: 'ready'; items: readonly CommunityTagDefinition[] }
  | { status: 'error'; items: readonly CommunityTagDefinition[] };

/**
 * Os IDs apenas definem prioridade visual dos atalhos. Rótulos e existência
 * continuam vindo exclusivamente do catálogo autoritativo das Functions.
 */
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
  ],
  templateUrl: './community-discovery-page.component.html',
  styleUrl: './community-discovery-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityDiscoveryPageComponent {
  private readonly repository = inject(CommunityPreviewRepository);
  private readonly tagRepository = inject(CommunityTagRepository);
  private readonly creationGate = inject(CommunityCreationGateService);
  private readonly discoveryCache = inject(CommunityDiscoveryCacheService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly tagCatalogReload$ = new Subject<void>();

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

  /**
   * O NgRx é a única autoridade dos cards, cursor e lifecycle de carregamento.
   * O signal local escolhe apenas qual consulta viewer-scoped deve ser observada.
   */
  readonly state$ = toObservable(this.selectedTagId).pipe(
    switchMap((tagId) =>
      this.discoveryCache.state$(this.cacheContext(tagId))
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor() {
    /**
     * A URL passa a ser parte do estado navegável da descoberta. Voltar/avançar
     * no navegador reaplica o interesse sem depender de estado imperativo local.
     */
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

    this.loadFirstPage(this.initialTagId);
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

    const context = this.cacheContext(this.selectedTagId());

    /**
     * A paginação só pode partir de uma primeira página ainda retida. Se o hard
     * TTL removeu o snapshot, revalidamos a base em vez de aceitar page 2 órfã.
     */
    this.discoveryCache.readSnapshot$(context).pipe(
      switchMap((snapshot) =>
        this.executePageLoad$(
          context,
          snapshot ? cursor : null,
          snapshot !== null
        )
      ),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  retry(): void {
    this.loadFirstPage(this.selectedTagId(), true);
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

  private loadFirstPage(tagId: string | null, force = false): void {
    const context = this.cacheContext(tagId);

    this.discoveryCache.readSnapshot$(context).pipe(
      switchMap((snapshot) => {
        if (snapshot?.fresh && !force) return EMPTY;
        return this.executePageLoad$(context, null, false);
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  private executePageLoad$(
    context: CommunityDiscoveryCacheContext,
    cursor: string | null,
    append: boolean
  ): Observable<CommunityDiscoveryPage> {
    this.discoveryCache.beginLoad(context, append);

    return this.fetchPage$(cursor, context, append).pipe(
      catchError((error: unknown) => {
        this.discoveryCache.failLoad(context, append);
        this.reportError(error);
        return EMPTY;
      })
    );
  }

  private fetchPage$(
    cursor: string | null,
    context: CommunityDiscoveryCacheContext,
    append: boolean
  ): Observable<CommunityDiscoveryPage> {
    const page$ = this.discoveryMode === 'mine'
      ? this.repository.getMyCommunitiesPage$({
          limit: DEFAULT_COMMUNITY_DISCOVERY_PAGE_SIZE,
          cursor,
          sourceType: 'community',
        })
      : this.repository.getDiscoveryPage$({
          limit: DEFAULT_COMMUNITY_DISCOVERY_PAGE_SIZE,
          cursor,
          sourceType: this.sourceType,
          tagId: this.canFilterByTags ? context.tagId : null,
        });

    return page$.pipe(
      tap((page) => this.discoveryCache.rememberPage(context, page, append))
    );
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
    this.loadFirstPage(tagId);

    if (!syncUrl) return;

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { interesse: tagId },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private reportTagCatalogError(error: unknown): void {
    try {
      this.errorNotifier.showWarning(
        'Os filtros por interesse não puderam ser carregados agora.'
      );
    } catch {
      // O diagnóstico centralizado abaixo permanece ativo.
    }

    this.reportTechnicalError(error, 'getCommunityTagCatalog');
  }

  private reportError(error: unknown): void {
    try {
      this.errorNotifier.showError(
        `Não foi possível carregar ${this.title.toLowerCase()}.`
      );
    } catch {
      // A observabilidade abaixo permanece ativa.
    }

    this.reportTechnicalError(error, 'loadPage');
  }

  private reportTechnicalError(error: unknown, op: string): void {
    try {
      const normalized = error instanceof Error ? error : new Error(String(error));
      const contextual = normalized as Error & {
        context?: unknown;
        skipUserNotification?: boolean;
      };
      contextual.context = {
        scope: 'CommunityDiscoveryPageComponent',
        op,
        sourceType: this.sourceType,
        discoveryMode: this.discoveryMode,
        tagId: this.selectedTagId(),
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // Falha secundária não interrompe o estado visual.
    }
  }
}
