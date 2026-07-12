import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { RouterModule } from '@angular/router';
import {
  BehaviorSubject,
  Observable,
  combineLatest,
  of,
} from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  startWith,
  switchMap,
  take,
} from 'rxjs/operators';

import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { MediaPublicQueryService } from 'src/app/core/services/media/media-public-query.service';
import {
  IProfilePhotoItem,
  PhotoViewerComponent,
} from 'src/app/media/photos/photo-viewer/photo-viewer.component';

type ProfileMediaShowcaseStatus = 'loading' | 'ready' | 'empty' | 'error';

interface ProfileMediaShowcaseState {
  status: ProfileMediaShowcaseStatus;
  items: IPublicPhotoItem[];
}

const SHOWCASE_ITEM_LIMIT = 5;

@Component({
  selector: 'app-profile-media-showcase',
  standalone: true,
  imports: [CommonModule, RouterModule, MatDialogModule],
  templateUrl: './profile-media-showcase.component.html',
  styleUrls: ['./profile-media-showcase.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileMediaShowcaseComponent {
  private readonly dialog = inject(MatDialog);
  private readonly mediaPublicQuery = inject(MediaPublicQueryService);
  private readonly errorNotification = inject(ErrorNotificationService);

  readonly ownerUid = input.required<string>();
  readonly profileName = input('Perfil');

  private readonly refreshSubject = new BehaviorSubject<number>(0);
  private readonly ownerUid$ = toObservable(this.ownerUid).pipe(
    map((uid) => (uid ?? '').trim()),
    distinctUntilChanged()
  );

  readonly galleryLink = computed(() => [
    '/media',
    'perfil',
    (this.ownerUid() ?? '').trim(),
    'fotos-publicas',
  ]);

  readonly state$: Observable<ProfileMediaShowcaseState> = combineLatest([
    this.ownerUid$,
    this.refreshSubject,
  ]).pipe(
    switchMap(([ownerUid]) => {
      if (!ownerUid) {
        return of<ProfileMediaShowcaseState>({
          status: 'empty',
          items: [],
        });
      }

      return this.mediaPublicQuery.getProfilePublicPhotos$(ownerUid, {
        propagateErrors: true,
      }).pipe(
        map((items): ProfileMediaShowcaseState => ({
          status: items.length > 0 ? 'ready' : 'empty',
          items,
        })),
        startWith<ProfileMediaShowcaseState>({
          status: 'loading',
          items: [],
        }),
        catchError(() => {
          this.errorNotification.showError(
            'Não foi possível carregar as mídias deste perfil agora.'
          );

          return of<ProfileMediaShowcaseState>({
            status: 'error',
            items: [],
          });
        })
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  retry(): void {
    this.refreshSubject.next(this.refreshSubject.value + 1);
  }

  openPhoto(index: number): void {
    this.state$
      .pipe(take(1))
      .subscribe((state) => {
        if (state.status !== 'ready' || !state.items.length) {
          return;
        }

        const safeIndex = Math.max(0, Math.min(index, state.items.length - 1));
        const viewerItems = state.items.map((item) => this.toViewerPhotoItem(item));
        const selected = viewerItems[safeIndex];

        this.dialog.open(PhotoViewerComponent, {
          data: {
            ownerUid: selected?.ownerUid ?? (this.ownerUid() ?? '').trim(),
            items: viewerItems,
            startIndex: safeIndex,
            source: 'profile',
          },
          autoFocus: false,
          restoreFocus: true,
          width: '100vw',
          height: '100vh',
          maxWidth: '100vw',
          maxHeight: '100vh',
          panelClass: ['photo-viewer-dialog', 'photo-viewer-dialog--immersive'],
          backdropClass: 'photo-viewer-backdrop',
        });
      });
  }

  visibleItems(items: readonly IPublicPhotoItem[]): readonly IPublicPhotoItem[] {
    return items.slice(0, SHOWCASE_ITEM_LIMIT);
  }

  remainingCount(total: number): number {
    return Math.max(0, total - SHOWCASE_ITEM_LIMIT);
  }

  trackByPhotoId(_index: number, item: IPublicPhotoItem): string {
    return item.id;
  }

  getPhotoAriaLabel(item: IPublicPhotoItem, index: number, total: number): string {
    const position = `${index + 1} de ${total}`;
    const label = item.alt?.trim() || `Foto publicada por ${this.profileName()}`;

    return `Abrir ${label}. Mídia ${position}.`;
  }

  private toViewerPhotoItem(item: IPublicPhotoItem): IProfilePhotoItem {
    return {
      id: item.id,
      ownerUid: item.ownerUid,
      url: item.url,
      alt: item.alt,
      createdAt: item.createdAt,
      commentsEnabled: item.commentsEnabled ?? false,
      commentsPolicy: item.commentsPolicy ?? 'OFF',
      reactionsEnabled: item.reactionsEnabled ?? false,
      moderationStatus: item.moderationStatus ?? 'PRIVATE',
    };
  }
}
