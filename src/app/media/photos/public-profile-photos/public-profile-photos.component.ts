// src/app/media/photos/public-profile-photos/public-profile-photos.component.ts
// Galeria pública de fotos do perfil.
//
// Ajustes desta versão:
// - mantém leitura somente da projeção pública;
// - transforma a página em galeria real, não foto gigante;
// - abre o viewer pela porta canônica pública;
// - mantém Observable e tratamento centralizado de erro.

import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';

import {
  BehaviorSubject,
  defer,
  EMPTY,
  Observable,
  combineLatest,
  of,
} from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  finalize,
  map,
  shareReplay,
  startWith,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import {
  IPublicProfilePhotoCursor,
  PublicProfilePhotoPaginationService,
} from 'src/app/core/services/media/public-profile-photo-pagination.service';
import { MediaApplicationErrorService } from 'src/app/core/services/media/media-application-error.service';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { visitedProfileReturnRoute } from 'src/app/core/utils/media/visited-profile-return-route';
import {
  normalizePublicUserIdentity,
  type PublicUserIdentity,
} from 'src/app/core/domain/public-user-identity/public-user-identity.model';
import { PublicUserIdentityComponent } from 'src/app/core/components/public-user-identity/public-user-identity.component';
import type { MediaErrorReason } from 'src/app/core/services/media/media-error.catalog';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { ContentStateComponent } from 'src/app/shared/content-state/content-state.component';
import { PageHeaderComponent } from 'src/app/shared/page-header/page-header.component';

import { PublicPhotoViewerLauncherService } from '../photo-viewer/public-photo-viewer-launcher.service';
import { PublicPhotoCardComponent } from '../../shared/components/public-photo-card/public-photo-card.component';

export type PublicProfilePhotoPageSize = 8 | 12 | 24;

export function resolvePublicProfilePhotoPageSize(
  containerWidth: number
): PublicProfilePhotoPageSize {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return 24;
  }

  if (containerWidth < 420) {
    return 8;
  }

  // Um lote de 12 equivale a 6 linhas na grade de duas colunas.
  if (containerWidth < 800) {
    return 12;
  }

  return 24;
}
interface PublicProfilePhotosState {
  readonly status: 'loading' | 'ready' | 'empty' | 'error';
  readonly items: readonly IPublicPhotoItem[];
  readonly ownerUid: string;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly pageError: boolean;
}

@Component({
  selector: 'app-public-profile-photos',
  standalone: true,
  imports: [
    CommonModule,
    PublicPhotoCardComponent,
    ContentStateComponent,
    PageHeaderComponent,
    PublicUserIdentityComponent,
    RouterModule,
  ],
  templateUrl: './public-profile-photos.component.html',
  styleUrls: ['./public-profile-photos.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicProfilePhotosComponent implements AfterViewInit {
  private readonly route = inject(ActivatedRoute);
  private readonly photoPagination = inject(PublicProfilePhotoPaginationService);
  private readonly publicUserQuery = inject(FirestoreUserQueryService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly galleryContainer =
    viewChild<ElementRef<HTMLElement>>('galleryContainer');
  private readonly photoViewerLauncher = inject(PublicPhotoViewerLauncherService);
  private readonly errorHandler = inject(MediaApplicationErrorService);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);

  private readonly DEBUG = false;

  readonly ownerUid$: Observable<string> = this.route.paramMap.pipe(
    map((params) => (params.get('id') ?? '').trim()),
    distinctUntilChanged(),
    tap((ownerUid) =>
      this.debug('ownerUid$', {
        hasOwnerUid: !!ownerUid,
      })
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly viewerUid$: Observable<string | null> = this.currentUserStore.user$.pipe(
    map((user) => user?.uid ?? null),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  profileReturnRoute(ownerUid: string, viewerUid: string | null): string[] {
    return visitedProfileReturnRoute(ownerUid, viewerUid);
  }

  /** Mesmo perfil público autorizado da tela visitada; nunca consulta /users. */
  readonly profileIdentity$: Observable<PublicUserIdentity | null> =
    this.ownerUid$.pipe(
      switchMap((ownerUid) => {
        if (!ownerUid) return of(null);
        return this.publicUserQuery.getPublicUserById$(ownerUid).pipe(
          map((profile): PublicUserIdentity | null => {
            if (profile?.uid !== ownerUid || !profile.nickname?.trim()) {
              return null;
            }
            // Fonte pública autorizada; não transportar documento privado ou
            // inferir orientação a partir de gênero, preferências ou mídia.
            return normalizePublicUserIdentity({
              nickname: profile.nickname,
              avatarUrl: profile.photoURL,
              identityCode: profile.identityCode ?? profile.gender,
              orientation: profile.orientation,
              city: profile.municipio,
              state: profile.estado,
            });
          }),
          catchError((error: unknown) => {
            this.reportError('media_discovery_load_failed', error, {
              op: 'loadGalleryProfileIdentity',
            });
            return of(null);
          }),
          startWith(null)
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  private readonly refreshSubject = new BehaviorSubject<number>(0);
  private readonly pageSizeSubject =
    new BehaviorSubject<PublicProfilePhotoPageSize | null>(null);
  private readonly galleryPagesSubject =
    new BehaviorSubject<readonly (readonly IPublicPhotoItem[])[]>([]);
  private readonly loadingMoreSubject = new BehaviorSubject(false);
  private readonly pageErrorSubject = new BehaviorSubject(false);

  private galleryOwnerUid = '';
  private galleryRevision = 0;
  private galleryCursor: IPublicProfilePhotoCursor | null = null;
  private galleryHasMore = false;
  private viewerOpening = false;
  private resizeObserver: ResizeObserver | null = null;

  readonly state$: Observable<PublicProfilePhotosState> = combineLatest([
    this.ownerUid$,
    this.refreshSubject,
  ]).pipe(
    switchMap(([ownerUid]) => {
      this.resetGallery(ownerUid);
      const revision = this.galleryRevision;

      if (!ownerUid) {
        return of(this.buildState('empty', []));
      }

      return this.pageSizeSubject.pipe(
        filter(
          (pageSize): pageSize is PublicProfilePhotoPageSize =>
            pageSize !== null
        ),
        take(1),
        switchMap((pageSize) =>
          this.photoPagination.loadPage$(ownerUid, { pageSize })
        ),
        switchMap((page) => {
          if (!this.isCurrentGallery(ownerUid, revision)) {
            return EMPTY;
          }

          this.galleryCursor = page.nextCursor;
          this.galleryHasMore = page.hasMore;
          this.galleryPagesSubject.next([page.items]);

          return combineLatest([
            this.galleryPagesSubject,
            this.loadingMoreSubject,
            this.pageErrorSubject,
          ]).pipe(
            map(([pages, loadingMore, pageError]) => {
              const items = this.mergePages(pages);
              const status =
                items.length || this.galleryHasMore ? 'ready' : 'empty';

              return this.buildState(
                status,
                items,
                loadingMore,
                pageError
              );
            })
          );
        }),
        startWith(this.buildState('loading', [])),
        catchError((error: unknown) => {
          if (!this.isCurrentGallery(ownerUid, revision)) {
            return EMPTY;
          }

          this.reportError(
            'media_discovery_load_failed',
            error,
            { op: 'loadPublicProfilePhotos' }
          );

          return of(this.buildState('error', []));
        })
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly publicPhotos$: Observable<IPublicPhotoItem[]> = this.state$.pipe(
    map((state) => [...state.items]),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  ngAfterViewInit(): void {
    const container = this.galleryContainer()?.nativeElement;

    if (!container) {
      return;
    }

    const computed = getComputedStyle(container);
    const paddingLeft = Number.parseFloat(computed.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(computed.paddingRight) || 0;

    const initialContentWidth =
      container.clientWidth - paddingLeft - paddingRight;

    this.updatePageSizeFromWidth(initialContentWidth);

    if (typeof ResizeObserver === 'undefined') {
      if (this.pageSizeSubject.value === null) {
        this.pageSizeSubject.next(24);
      }
      return;
    }

    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries.find((item) => item.target === container);

      if (entry) {
        this.updatePageSizeFromWidth(entry.contentRect.width);
      }
    });

    this.resizeObserver.observe(container);

    this.destroyRef.onDestroy(() => {
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
    });
  }

  private updatePageSizeFromWidth(width: number): void {
    if (!Number.isFinite(width) || width <= 0) {
      return;
    }

    const next = resolvePublicProfilePhotoPageSize(width);

    if (this.pageSizeSubject.value !== next) {
      this.pageSizeSubject.next(next);
    }
  }
  retry(): void {
    this.refreshSubject.next(this.refreshSubject.value + 1);
  }

  loadMorePhotos(): void {
    const ownerUid = this.galleryOwnerUid;
    const cursor = this.galleryCursor;
    const revision = this.galleryRevision;

    if (
      !ownerUid ||
      !cursor ||
      !this.galleryHasMore ||
      this.loadingMoreSubject.value
    ) {
      return;
    }

    this.pageErrorSubject.next(false);
    this.loadingMoreSubject.next(true);

    this.photoPagination.loadPage$(ownerUid, {
      cursor,
      pageSize: this.pageSizeSubject.value ?? 24,
    }).pipe(
      take(1),
      tap((page) => {
        if (!this.isCurrentGallery(ownerUid, revision)) {
          return;
        }

        this.galleryCursor = page.nextCursor;
        this.galleryHasMore = page.hasMore;
        this.galleryPagesSubject.next([
          ...this.galleryPagesSubject.value,
          page.items,
        ]);
      }),
      catchError(() => {
        if (this.isCurrentGallery(ownerUid, revision)) {
          this.pageErrorSubject.next(true);
        }

        return EMPTY;
      }),
      finalize(() => {
        if (this.isCurrentGallery(ownerUid, revision)) {
          this.loadingMoreSubject.next(false);
        }
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  openPhoto(
    index: number,
    expectedPhoto?: Pick<IPublicPhotoItem, 'id' | 'ownerUid'>
  ): void {
    if (
      this.viewerOpening ||
      !Number.isInteger(index) ||
      index < 0
    ) {
      return;
    }

    this.state$.pipe(
      take(1),
      switchMap((state) => {
        if (
          state.status !== 'ready' ||
          state.ownerUid !== this.galleryOwnerUid ||
          index >= state.items.length
        ) {
          return EMPTY;
        }

        const selected = state.items[index];

        if (
          !selected ||
          (
            expectedPhoto &&
            (
              selected.id !== expectedPhoto.id ||
              selected.ownerUid !== expectedPhoto.ownerUid
            )
          )
        ) {
          return EMPTY;
        }

        return defer(() => {
          this.viewerOpening = true;

          return this.photoViewerLauncher.openWithResult$({
            items: [...state.items],
            selected,
            source: 'profile',
          });
        }).pipe(
          finalize(() => {
            this.viewerOpening = false;
          })
        );
      }),
      catchError((error: unknown) => {
        this.reportError(
          'media_navigation_failed',
          error,
          { op: 'openPhoto' }
        );
        return EMPTY;
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  private resetGallery(ownerUid: string): void {
    this.galleryRevision += 1;
    this.galleryOwnerUid = ownerUid;
    this.galleryCursor = null;
    this.galleryHasMore = false;
    this.galleryPagesSubject.next([]);
    this.loadingMoreSubject.next(false);
    this.pageErrorSubject.next(false);
  }

  private isCurrentGallery(
    ownerUid: string,
    revision: number
  ): boolean {
    return (
      this.galleryOwnerUid === ownerUid &&
      this.galleryRevision === revision
    );
  }

  private mergePages(
    pages: readonly (readonly IPublicPhotoItem[])[]
  ): IPublicPhotoItem[] {
    const unique = new Map<string, IPublicPhotoItem>();

    for (const item of pages.flat()) {
      if (
        item.ownerUid !== this.galleryOwnerUid ||
        !item.id?.trim()
      ) {
        continue;
      }

      const key = `${item.ownerUid}:${item.id}`;

      if (!unique.has(key)) {
        unique.set(key, item);
      }
    }

    return [...unique.values()];
  }

  private buildState(
    status: PublicProfilePhotosState['status'],
    items: readonly IPublicPhotoItem[],
    loadingMore = false,
    pageError = false
  ): PublicProfilePhotosState {
    return {
      status,
      items,
      ownerUid: this.galleryOwnerUid,
      hasMore: this.galleryHasMore,
      loadingMore,
      pageError,
    };
  }
  trackByPhotoId(_index: number, item: IPublicPhotoItem): string {
    return item.id;
  }

  private reportError(
    reasonHint: MediaErrorReason,
    error: unknown,
    context?: Record<string, unknown>
  ): void {
    this.errorHandler.report(error, {
      operation: String(context?.['op'] ?? 'unknown'),
      reasonHint,
      metadata: {
        scope: 'PublicProfilePhotosComponent',
        ...(context ?? {}),
      },
    });

    this.debug('reportError', {
      reasonHint,
      op: context?.['op'] ?? 'unknown',
      hasContext: !!context,
      errorMessage: error instanceof Error ? error.message : String(error ?? ''),
    });
  }

  private debug(message: string, extra?: unknown): void {
    if (!this.DEBUG) return;
    this.privacyDebug.log('media', `PublicProfilePhotos: ${message}`, extra);
  }
}
