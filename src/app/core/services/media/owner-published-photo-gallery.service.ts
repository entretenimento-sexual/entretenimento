import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject, Subscription } from 'rxjs';
import { take } from 'rxjs/operators';

import type { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import type { IPublicMediaOwnerCursor } from 'src/app/core/interfaces/media/i-public-media-owner-page';
import { MediaApplicationErrorService } from './media-application-error.service';
import { PublicMediaOwnerPageQueryService } from './public-media-owner-page-query.service';

export interface IOwnerPublishedPhotoGalleryState {
  readonly ownerUid: string;
  readonly items: readonly IPublicPhotoItem[];
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly hasMore: boolean;
  readonly pageError: boolean;
  readonly failed: boolean;
}

/** Mapeia somente mídias do proprietário, preservando ordem e evitando duplicatas. */
export function mergeOwnerPublishedPhotos(
  ownerUid: string,
  previous: readonly IPublicPhotoItem[],
  incoming: readonly IPublicPhotoItem[]
): IPublicPhotoItem[] {
  const unique = new Map<string, IPublicPhotoItem>();
  for (const photo of [...previous, ...incoming]) {
    if (photo.ownerUid !== ownerUid || !String(photo.id ?? '').trim()) {
      continue;
    }
    if (!unique.has(photo.id)) {
      unique.set(photo.id, photo);
    }
  }
  return [...unique.values()];
}

const EMPTY_STATE: IOwnerPublishedPhotoGalleryState = {
  ownerUid: '',
  items: [],
  loading: false,
  loadingMore: false,
  hasMore: false,
  pageError: false,
  failed: false,
};

/**
 * Galeria de publicações sociais do proprietário.
 * A origem da lista é o backend autorizado PUBLIC/FRIENDS, nunca o acervo
 * técnico de upload. URLs assinadas são obtidas pelo serviço público existente.
 */
@Injectable()
export class OwnerPublishedPhotoGalleryService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly ownerPages = inject(PublicMediaOwnerPageQueryService);
  private readonly errors = inject(MediaApplicationErrorService);
  private readonly stateSubject =
    new BehaviorSubject<IOwnerPublishedPhotoGalleryState>(EMPTY_STATE);

  readonly state$ = this.stateSubject.asObservable();
  private ownerUid = '';
  private allowed = false;
  private revision = 0;
  private cursor: IPublicMediaOwnerCursor | null = null;
  private pending: Subscription | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.pending?.unsubscribe());
  }

  connect(ownerUid: string, allowed: boolean): void {
    const owner = String(ownerUid ?? '').trim();
    if (owner === this.ownerUid && allowed === this.allowed) return;

    this.revision++;
    this.pending?.unsubscribe();
    this.pending = null;
    this.ownerUid = owner;
    this.allowed = allowed;
    this.cursor = null;
    this.stateSubject.next({ ...EMPTY_STATE, ownerUid: owner });

    if (owner && allowed) {
      this.requestPage(null);
    }
  }

  loadMorePhotos(): void {
    const state = this.stateSubject.value;
    if (
      !this.allowed || !this.ownerUid || state.loading ||
      state.loadingMore || !state.hasMore || !this.cursor
    ) {
      return;
    }
    this.requestPage(this.cursor);
  }

  retry(): void {
    if (!this.allowed || !this.ownerUid) return;
    const state = this.stateSubject.value;
    if (state.loading || state.loadingMore) return;

    if (state.failed) {
      this.revision++;
      this.pending?.unsubscribe();
      this.cursor = null;
      this.stateSubject.next({ ...EMPTY_STATE, ownerUid: this.ownerUid });
      this.requestPage(null);
    } else if (state.pageError && this.cursor) {
      this.requestPage(this.cursor);
    }
  }

  private requestPage(cursor: IPublicMediaOwnerCursor | null): void {
    const ownerUid = this.ownerUid;
    const revision = this.revision;
    const current = this.stateSubject.value;
    const initial = cursor === null;
    this.stateSubject.next({
      ...current,
      loading: initial,
      loadingMore: !initial,
      pageError: false,
      failed: false,
    });

    this.pending = this.ownerPages.loadPhotoPage$({
      ownerUids: [ownerUid],
      pageSize: 24,
      cursor,
      notifyOnError: false,
    }).pipe(
      take(1),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (page) => {
        if (revision !== this.revision || ownerUid !== this.ownerUid) return;

        if (page.failed) {
          this.stateSubject.next({
            ...this.stateSubject.value,
            loading: false,
            loadingMore: false,
            failed: initial,
            pageError: !initial,
          });
          return;
        }

        this.cursor = page.nextCursor;
        const existing = initial ? [] : this.stateSubject.value.items;
        const items = mergeOwnerPublishedPhotos(ownerUid, existing, page.items);
        const hasMore = page.hasMore && this.cursor !== null;
        this.stateSubject.next({
          ownerUid,
          items,
          loading: false,
          loadingMore: false,
          hasMore,
          pageError: page.hasMore && !this.cursor,
          failed: false,
        });
      },
      error: (error: unknown) => {
        if (revision !== this.revision || ownerUid !== this.ownerUid) return;
        this.errors.report(error, {
          operation: initial ? 'ownerGallery.loadInitial' : 'ownerGallery.loadMorePhotos',
          reasonHint: 'media_discovery_page_failed',
          metadata: { scope: 'OwnerPublishedPhotoGalleryService', hasCursor: !initial },
        });
        this.stateSubject.next({
          ...this.stateSubject.value,
          loading: false,
          loadingMore: false,
          failed: initial,
          pageError: !initial,
        });
      },
    });
  }
}
