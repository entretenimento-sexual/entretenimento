import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import {
  BehaviorSubject,
  EMPTY,
  Observable,
  combineLatest,
  of,
} from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  finalize,
  map,
  shareReplay,
  switchMap,
  take,
} from 'rxjs/operators';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { IPublicProfileMediaItem } from 'src/app/core/interfaces/media/i-public-profile-media-item';
import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { UserIntentStatusService } from 'src/app/core/services/discovery/user-intent-status.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { buildPublicMediaIdentity } from 'src/app/core/utils/media/public-media-identity';
import { CompatibleProfileCandidatesService } from 'src/app/dashboard/discovery/application/compatible-profile-candidates.service';
import { UserIntentStatusComposerComponent } from 'src/app/dashboard/user-intent-status/user-intent-status-composer/user-intent-status-composer.component';
import { PublicPhotoCardComponent } from 'src/app/media/shared/components/public-photo-card/public-photo-card.component';
import { PublicVideoCardComponent } from 'src/app/media/shared/components/public-video-card/public-video-card.component';
import { PublicMixedMediaViewerLauncherService } from 'src/app/media/shared/services/public-mixed-media-viewer-launcher.service';
import { FeedPublicationComposerComponent } from '../../components/feed-publication-composer/feed-publication-composer.component';
import { ExploreFeedFacade } from '../../facades/explore-feed.facade';
import { buildExplorePersonalFeed } from '../../models/explore-personal-feed';
import {
  buildExploreSocialFeed,
  buildExploreSocialFeedWindow,
  ExploreSocialFeedItem,
  ExploreSocialFeedWindow,
} from '../../models/explore-social-feed';
import {
  ExplorePersonalMediaContext,
  ExplorePersonalMediaService,
} from '../../services/explore-personal-media.service';
import { IExploreFeedVm } from '../../services/explore-feed.service';

const FEED_INITIAL_VISIBLE_COUNT = 6;
const FEED_PAGE_SIZE = 6;
const FEED_POOL_LIMIT = 36;
const RELATED_STATUS_LIMIT = 24;

type SocialExploreVm = IExploreFeedVm & ExplorePersonalMediaContext & {
  /** Compatibilidade com o harness visual determinístico pré-paginação. */
  readonly compatibleOwnerUids?: readonly string[];
  readonly hasMorePersonalMedia?: boolean;
  readonly loadingMorePersonalMedia?: boolean;
  readonly loadingInitialPersonalMedia?: boolean;
  readonly personalMediaLoadFailed?: boolean;
};

interface SocialExploreFeedWindow extends ExploreSocialFeedWindow {
  readonly hasBackendMore: boolean;
  readonly loadingMore: boolean;
}

@Component({
  selector: 'app-social-explore-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    PublicPhotoCardComponent,
    PublicVideoCardComponent,
    FeedPublicationComposerComponent,
    UserIntentStatusComposerComponent,
  ],
  templateUrl: './social-explore-page.component.html',
  styleUrls: ['./social-explore-page.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SocialExplorePageComponent {
  @ViewChild(FeedPublicationComposerComponent)
  private publicationComposer?: FeedPublicationComposerComponent;

  @ViewChild(UserIntentStatusComposerComponent)
  private statusComposer?: UserIntentStatusComposerComponent;

  private readonly destroyRef = inject(DestroyRef);
  private readonly exploreFeedFacade = inject(ExploreFeedFacade);
  private readonly personalMedia = inject(ExplorePersonalMediaService);
  private readonly compatibleCandidates = inject(CompatibleProfileCandidatesService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly authSession = inject(AuthSessionService);
  private readonly statusService = inject(UserIntentStatusService);
  private readonly mixedMediaViewer = inject(PublicMixedMediaViewerLauncherService);
  private readonly errorNotification = inject(ErrorNotificationService);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);

  private readonly visibleFeedCountSubject =
    new BehaviorSubject<number>(FEED_INITIAL_VISIBLE_COUNT);

  readonly publicationComposerVisible = signal(false);
  readonly openingMediaKey = signal<string | null>(null);
  readonly failedVideoPosterKeys = signal<ReadonlySet<string>>(new Set<string>());

  readonly vm$: Observable<SocialExploreVm> = combineLatest([
    this.exploreFeedFacade.vm$,
    this.personalMedia.context$,
  ]).pipe(
    map(([vm, personal]) => ({
      ...vm,
      ...personal,
    })),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly compatibleProfiles$ = this.compatibleCandidates.profiles$.pipe(
    map((profiles) => [...profiles]),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly currentUser$: Observable<IUserDados | null> =
    this.currentUserStore.user$.pipe(
      map((user) => user ?? null),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly authUid$: Observable<string> = this.authSession.readyUid$.pipe(
    map((uid) => String(uid ?? '').trim()),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * Pool de fotos priorizado por amizade, compatibilidade e recência.
   * O limite cresce conforme novas páginas pessoais chegam; ele não é mais um
   * teto de backend, apenas um piso para a primeira composição da timeline.
   */
  private readonly photoFeedPool$: Observable<readonly IPublicPhotoItem[]> =
    combineLatest([
      this.vm$,
      this.compatibleProfiles$,
    ]).pipe(
      map(([vm, compatibleProfiles]) => {
        const candidateCount =
          vm.personalPhotos.length +
          vm.latestPhotos.length +
          vm.boostedPhotos.length +
          vm.topPhotos.length +
          vm.mostViewedPhotos.length;

        return buildExplorePersonalFeed(
          {
            ...vm,
            compatibleProfiles,
            compatibleOwnerUids: vm.compatibleOwnerUids ?? [],
          },
          {
            limit: Math.max(FEED_POOL_LIMIT, candidateCount),
          }
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  /**
   * Momentos públicos são consultados já restritos aos amigos/compatíveis
   * elegíveis. Isso evita que o limite regional seja consumido por autores que
   * seriam descartados depois no cliente.
   */
  private readonly relatedStatuses$ = combineLatest([
    this.authUid$,
    this.vm$,
    this.compatibleProfiles$,
  ]).pipe(
    switchMap(([uid, vm, compatibleProfiles]) => {
      if (!uid) {
        return of([]);
      }

      const relatedOwnerUids = new Set<string>();

      for (const friendUid of vm.friendUids) {
        const normalizedUid = String(friendUid ?? '').trim();
        if (normalizedUid && normalizedUid !== uid) {
          relatedOwnerUids.add(normalizedUid);
        }
      }

      for (const profile of compatibleProfiles) {
        const normalizedUid = String(profile?.uid ?? '').trim();
        if (normalizedUid && normalizedUid !== uid) {
          relatedOwnerUids.add(normalizedUid);
        }
      }

      for (const compatibleUid of vm.compatibleOwnerUids ?? []) {
        const normalizedUid = String(compatibleUid ?? '').trim();
        if (normalizedUid && normalizedUid !== uid) {
          relatedOwnerUids.add(normalizedUid);
        }
      }

      if (!relatedOwnerUids.size) {
        return of([]);
      }

      return this.statusService.watchActiveStatusesForUserRegion$(uid, {
        limit: RELATED_STATUS_LIMIT,
        ownerUids: [...relatedOwnerUids],
      });
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly socialFeedPool$: Observable<readonly ExploreSocialFeedItem[]> =
    combineLatest([
      this.photoFeedPool$,
      this.relatedStatuses$,
      this.vm$,
      this.authUid$,
      this.compatibleProfiles$,
    ]).pipe(
      map(([photos, statuses, vm, viewerUid, compatibleProfiles]) =>
        buildExploreSocialFeed(
          photos,
          statuses,
          vm.friendUids,
          compatibleProfiles,
          {
            limit: Math.max(
              FEED_POOL_LIMIT,
              photos.length + vm.personalVideos.length + statuses.length
            ),
            viewerUid,
            videos: vm.personalVideos,
            compatibleOwnerUids: vm.compatibleOwnerUids ?? [],
          }
        )
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  /**
   * Sequência canônica de mídia do feed. Momentos permanecem na timeline, mas
   * não entram no viewer porque possuem um contrato de interação próprio.
   * Foto e vídeo preservam a mesma ordem relativa calculada pelo feed social.
   */
  private readonly mediaFeedPool$: Observable<readonly IPublicProfileMediaItem[]> =
    this.socialFeedPool$.pipe(
      map((items) =>
        items.flatMap((item): IPublicProfileMediaItem[] => {
          if (item.kind === 'photo') return [item.photo];
          if (item.kind === 'video') return [item.video];
          return [];
        })
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly feedWindow$: Observable<SocialExploreFeedWindow> = combineLatest([
    this.socialFeedPool$,
    this.visibleFeedCountSubject.pipe(distinctUntilChanged()),
    this.vm$,
  ]).pipe(
    map(([items, visibleLimit, vm]) => {
      const localWindow = buildExploreSocialFeedWindow(items, visibleLimit);
      const hasBackendMore = vm.hasMorePersonalMedia === true;

      return {
        ...localWindow,
        hasBackendMore,
        loadingMore: vm.loadingMorePersonalMedia === true,
        hasMore: localWindow.hasMore || hasBackendMore,
      };
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  openPublicationComposer(openFilePicker = false): void {
    this.statusComposer?.closeComposer();
    this.publicationComposerVisible.set(true);

    if (openFilePicker) {
      queueMicrotask(() => this.publicationComposer?.openFilePicker());
    }
  }

  closePublicationComposer(): void {
    this.publicationComposerVisible.set(false);
  }

  onPublicationPublished(): void {
    this.publicationComposerVisible.set(false);
  }

  openFeedPhoto(photo: IPublicPhotoItem): void {
    this.openFeedMedia(photo);
  }

  openVideoHighlight(item: IPublicVideoItem): void {
    this.vm$.pipe(
      take(1),
      switchMap((vm) =>
        this.openMediaFromItems$(item, vm.videoHighlights)
      ),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  openFeedVideo(item: IPublicVideoItem): void {
    this.openFeedMedia(item);
  }

  retryVideoHighlights(): void {
    this.failedVideoPosterKeys.set(new Set<string>());
    this.exploreFeedFacade.retryVideoHighlights();
  }

  loadMoreFeed(): void {
    this.feedWindow$.pipe(
      take(1),
      switchMap((window) => {
        if (window.loadingMore || !window.hasMore) {
          return EMPTY;
        }

        if (window.remainingItems > 0) {
          this.visibleFeedCountSubject.next(
            Math.min(window.totalItems, window.visibleCount + FEED_PAGE_SIZE)
          );
          return EMPTY;
        }

        if (!window.hasBackendMore) {
          return EMPTY;
        }

        return this.loadMorePersonalMedia$().pipe(
          switchMap((loaded) =>
            loaded ? this.feedWindow$.pipe(take(1)) : EMPTY
          ),
          map((updatedWindow) => {
            this.visibleFeedCountSubject.next(
              Math.min(
                updatedWindow.totalItems,
                window.visibleCount + FEED_PAGE_SIZE
              )
            );
          })
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  trackByFeedItem(_index: number, item: ExploreSocialFeedItem): string {
    return item.key;
  }

  trackByVideoId(_index: number, item: IPublicVideoItem): string {
    return this.mediaKey(item);
  }

  isVideoOpening(item: IPublicVideoItem): boolean {
    return this.openingMediaKey() === this.mediaKey(item);
  }

  hasUsableVideoPoster(item: IPublicVideoItem): boolean {
    const key = this.mediaKey(item);
    return !!key &&
      !!item.posterUrl?.trim() &&
      !this.failedVideoPosterKeys().has(key);
  }

  onVideoPosterError(item: IPublicVideoItem): void {
    const key = this.mediaKey(item);

    if (!key || this.failedVideoPosterKeys().has(key)) {
      return;
    }

    this.failedVideoPosterKeys.update((current) => {
      const next = new Set(current);
      next.add(key);
      return next;
    });

    this.reportVideoViewerError(
      new Error('Falha ao carregar a capa de um vídeo no Explore.'),
      item,
      'loadExploreVideoPoster'
    );
  }

  private loadMorePersonalMedia$(): Observable<boolean> {
    const paginatedSource = this.personalMedia as ExplorePersonalMediaService & {
      loadMore$?: () => Observable<boolean>;
    };

    return typeof paginatedSource.loadMore$ === 'function'
      ? paginatedSource.loadMore$()
      : of(false);
  }

  private openFeedMedia(requested: IPublicProfileMediaItem): void {
    this.mediaFeedPool$.pipe(
      take(1),
      switchMap((items) => this.openMediaFromItems$(requested, items)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  private openMediaFromItems$(
    requested: IPublicProfileMediaItem,
    sourceItems: readonly IPublicProfileMediaItem[]
  ): Observable<void> {
    const requestedKey = this.mediaKey(requested);

    if (!requestedKey || this.openingMediaKey()) {
      return EMPTY;
    }

    const items = [...sourceItems];
    const selected = items.find(
      (candidate) => this.mediaKey(candidate) === requestedKey
    );

    if (!selected) {
      this.errorNotification.showWarning(
        'Esta publicação não está mais disponível para visitantes.'
      );
      return EMPTY;
    }

    this.openingMediaKey.set(requestedKey);

    return this.mixedMediaViewer.open$({
      items,
      selected,
      source: 'discover',
    }).pipe(
      catchError(() => {
        // O launcher canônico já envia o erro ao GlobalErrorHandlerService.
        // Aqui mantemos somente o feedback contextual para o usuário.
        this.errorNotification.showError(
          'Não foi possível abrir esta publicação neste momento.'
        );
        return EMPTY;
      }),
      finalize(() => {
        if (this.openingMediaKey() === requestedKey) {
          this.openingMediaKey.set(null);
        }
      })
    );
  }

  private mediaKey(item: IPublicProfileMediaItem): string {
    return buildPublicMediaIdentity(
      item.mediaType === 'VIDEO' ? 'VIDEO' : 'PHOTO',
      item.ownerUid,
      item.id
    );
  }

  private reportVideoViewerError(
    error: unknown,
    item: IPublicVideoItem,
    op = 'openExploreVideoViewer'
  ): void {
    try {
      const normalized = error instanceof Error
        ? new Error(error.message)
        : new Error('Falha no vídeo público do Explore.');

      (normalized as any).original = error;
      (normalized as any).context = {
        scope: 'SocialExplorePageComponent',
        op,
        hasOwnerUid: !!item.ownerUid,
        hasVideoId: !!item.id,
      };
      (normalized as any).skipUserNotification = true;

      this.globalErrorHandler.handleError(normalized);
    } catch {
      // O diagnóstico não pode interromper a navegação do Explore.
    }
  }
}
