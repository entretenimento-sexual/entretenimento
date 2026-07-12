import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { RouterModule } from '@angular/router';
import {
  BehaviorSubject,
  Observable,
  combineLatest,
  firstValueFrom,
  of,
} from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs/operators';

import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { MediaPublicQueryService } from 'src/app/core/services/media/media-public-query.service';
import type { IProfilePhotoItem } from '../../../photos/photo-viewer/photo-viewer.component';

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
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);

  readonly ownerUid = input.required<string>();
  readonly profileName = input('Perfil');
  readonly viewerOpening = signal(false);

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
        startWith({
          status: 'loading',
          items: [],
        } as ProfileMediaShowcaseState),
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

  async openPhoto(photoId: string, fallbackIndex: number): Promise<void> {
    const ownerUid = (this.ownerUid() ?? '').trim();
    const safePhotoId = (photoId ?? '').trim();

    if (!ownerUid || !safePhotoId || this.viewerOpening()) {
      return;
    }

    this.viewerOpening.set(true);

    let items: IPublicPhotoItem[];

    try {
      items = await firstValueFrom(
        this.mediaPublicQuery.getProfilePublicPhotos$(ownerUid, {
          propagateErrors: true,
        })
      );
    } catch {
      this.errorNotification.showError(
        'Não foi possível atualizar o acesso às mídias deste perfil.'
      );
      this.viewerOpening.set(false);
      return;
    }

    if (!items.length) {
      this.errorNotification.showWarning(
        'Esta foto não está mais disponível para visitantes.'
      );
      this.viewerOpening.set(false);
      return;
    }

    const refreshedIndex = items.findIndex((item) => item.id === safePhotoId);
    const safeIndex = refreshedIndex >= 0
      ? refreshedIndex
      : Math.max(0, Math.min(fallbackIndex, items.length - 1));
    const viewerItems = items.map((item) => this.toViewerPhotoItem(item));
    const selected = viewerItems[safeIndex];

    try {
      const { PhotoViewerComponent } = await import(
        '../../../photos/photo-viewer/photo-viewer.component'
      );

      this.dialog.open(PhotoViewerComponent, {
        data: {
          ownerUid: selected?.ownerUid ?? ownerUid,
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
    } catch (error) {
      this.reportViewerError(error, ownerUid, safePhotoId);
      this.errorNotification.showError(
        'Não foi possível abrir a visualização imersiva.'
      );
    } finally {
      this.viewerOpening.set(false);
    }
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

  private reportViewerError(
    error: unknown,
    ownerUid: string,
    photoId: string
  ): void {
    try {
      const normalizedError = error instanceof Error
        ? error
        : new Error('Falha ao carregar o visualizador de mídia.');

      (normalizedError as any).original = error;
      (normalizedError as any).context = {
        scope: 'ProfileMediaShowcaseComponent',
        op: 'openPhoto.viewer',
        hasOwnerUid: !!ownerUid,
        hasPhotoId: !!photoId,
      };
      (normalizedError as any).skipUserNotification = true;

      this.globalErrorHandler.handleError(normalizedError);
    } catch {
      // noop
    }
  }
}
