// src/app/media/photos/profile-photos/profile-photos.component.ts
// Galeria privada do perfil.
//
// AJUSTES DESTA VERSÃO:
// - mantém viewer, edição e exclusão
// - adiciona VM de publicação para badges
// - adiciona ações de publicação / despublicação / capa
// - continua tratando users/{uid}/photos como biblioteca privada
// - não mistura estado de publicação no documento privado
//
// OBSERVAÇÃO IMPORTANTE:
// - deixe publicationFeatureReady = false até as rules de:
//   1) users/{uid}/photo_publications/{photoId}
//   2) public_profiles/{uid}/photos/{photoId}
//   estarem deployadas.
// - depois do deploy correto, troque para true.
import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';

import { BehaviorSubject, EMPTY, Observable, combineLatest, from, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  finalize,
  map,
  shareReplay,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { MediaPolicyService, IMediaPolicyResult } from 'src/app/core/services/media/media-policy.service';
import { MediaQueryService } from 'src/app/core/services/media/media-query.service';
import { MediaPublicationService } from 'src/app/core/services/media/media-publication.service';
import { PhotoFirestoreService } from 'src/app/core/services/image-handling/photo-firestore.service';
import { PhotoEditorSessionService } from 'src/app/core/services/image-handling/photo-editor-session.service';
import { IPhotoPublicationConfig } from 'src/app/core/interfaces/media/i-photo-publication-config';

import { PhotoViewerComponent, IProfilePhotoItem } from '../photo-viewer/photo-viewer.component';
import { PhotoEditorComponent } from 'src/app/photo-editor/photo-editor/photo-editor.component';

type IManageablePhotoItem = IProfilePhotoItem & {
  path?: string;
  fileName?: string;
  ownerUid: string;
};

type IPhotoCardVm = IManageablePhotoItem & {
  publication: IPhotoPublicationConfig;
};

const DENY_UNKNOWN: IMediaPolicyResult = { decision: 'DENY', reason: 'UNKNOWN' };

@Component({
  selector: 'app-profile-photos',
  standalone: true,
  imports: [CommonModule, RouterModule, MatDialogModule],
  templateUrl: './profile-photos.component.html',
  styleUrls: ['./profile-photos.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfilePhotosComponent {
  private readonly destroyRef = inject(DestroyRef); // reservado para evolução futura
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly modal = inject(NgbModal);

  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly policy = inject(MediaPolicyService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly errorHandler = inject(GlobalErrorHandlerService);
  private readonly mediaQuery = inject(MediaQueryService);
  private readonly mediaPublicationService = inject(MediaPublicationService);
  private readonly photoFirestoreService = inject(PhotoFirestoreService);
  private readonly photoEditorSession = inject(PhotoEditorSessionService);

  // Troque para true só depois de deployar as novas rules da camada de publicação.
  readonly publicationFeatureReady = true;

  private readonly confirmDeleteIdSubject = new BehaviorSubject<string | null>(null);
  readonly confirmDeleteId$ = this.confirmDeleteIdSubject.asObservable();

  private readonly deletingPhotoIdSubject = new BehaviorSubject<string | null>(null);
  readonly deletingPhotoId$ = this.deletingPhotoIdSubject.asObservable();

  private readonly publishingPhotoIdSubject = new BehaviorSubject<string | null>(null);
  readonly publishingPhotoId$ = this.publishingPhotoIdSubject.asObservable();

  private readonly DEBUG = true;

  private debug(msg: string, data?: unknown): void {
    if (!this.DEBUG) return;
    // eslint-disable-next-line no-console
    console.debug(`[ProfilePhotos] ${msg}`, data ?? '');
  }

  readonly viewerUid$: Observable<string | null> = this.currentUserStore.user$.pipe(
    map((u) => u?.uid ?? null),
    distinctUntilChanged(),
    tap((uid) => this.debug('viewerUid$', uid)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly ownerUid$: Observable<string> = combineLatest([
    this.route.paramMap.pipe(
      map((p) => p.get('id')),
      distinctUntilChanged()
    ),
    this.viewerUid$
  ]).pipe(
    map(([routeId, viewerUid]) => routeId ?? viewerUid ?? ''),
    distinctUntilChanged(),
    tap((id) => this.debug('ownerUid$', id)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly isOwner$: Observable<boolean> = combineLatest([
    this.viewerUid$,
    this.ownerUid$,
  ]).pipe(
    map(([viewerUid, ownerUid]) => !!viewerUid && viewerUid === ownerUid),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly policyResult$: Observable<IMediaPolicyResult> = combineLatest([
    this.viewerUid$,
    this.ownerUid$
  ]).pipe(
    switchMap(([viewer, owner]) => (owner ? this.policy.canViewProfilePhotos$(viewer, owner) : of(DENY_UNKNOWN))),
    tap((r) => this.debug('policyResult$', r)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly canView$: Observable<boolean> = this.policyResult$.pipe(
    map((r) => r.decision === 'ALLOW'),
    distinctUntilChanged()
  );

  readonly photos$: Observable<IManageablePhotoItem[]> = combineLatest([this.ownerUid$, this.canView$]).pipe(
    switchMap(([ownerUid, canView]) => {
      if (!ownerUid || !canView) return of([] as IManageablePhotoItem[]);
      return this.mediaQuery.watchProfilePhotos$(ownerUid);
    }),
    tap((items) => this.debug('photos$', { count: items.length })),
    catchError((err) => {
      this.errorNotifier.showError(err);
      return of([] as IManageablePhotoItem[]);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly publicationConfigs$: Observable<Record<string, IPhotoPublicationConfig>> = this.ownerUid$.pipe(
    switchMap((ownerUid) => {
      if (!ownerUid) return of({});
      return this.mediaPublicationService.getPublicationConfigsByOwner$(ownerUid);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly photoCards$: Observable<IPhotoCardVm[]> = combineLatest([
    this.ownerUid$,
    this.photos$,
    this.publicationConfigs$,
  ]).pipe(
    map(([ownerUid, photos, publicationConfigs]) =>
      photos.map((photo) => ({
        ...photo,
        publication:
          publicationConfigs[photo.id] ??
          this.mediaPublicationService.buildDefaultConfig(ownerUid, photo.id),
      }))
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly isEmpty$: Observable<boolean> = this.photoCards$.pipe(
    map((items) => items.length === 0),
    distinctUntilChanged()
  );

  openUpload(ownerUid: string): void {
    this.router.navigate(['/media', 'perfil', ownerUid, 'fotos', 'upload']).catch(() => {
      this.errorNotifier.showError('Falha ao navegar para upload.');
    });
  }

  openPhoto(targetId: string): void {
    combineLatest([this.canView$, this.ownerUid$, this.photoCards$]).pipe(
      take(1),
      switchMap(([canView, ownerUid, items]) => {
        if (!canView) {
          this.errorNotifier.showError('Você não tem permissão para ver essas fotos.');
          return EMPTY;
        }

        const startIndex = Math.max(0, items.findIndex((i) => i.id === targetId));

        this.dialog.open(PhotoViewerComponent, {
          data: { ownerUid, items, startIndex },
          autoFocus: true,
          restoreFocus: true,
          maxWidth: '96vw',
          panelClass: 'photo-viewer-dialog',
        });

        return EMPTY;
      }),
      catchError((err) => {
        this.errorNotifier.showError(err);
        return EMPTY;
      })
    ).subscribe();
  }

  editPhoto(item: IPhotoCardVm, event?: Event): void {
    event?.stopPropagation();

    combineLatest([this.isOwner$, this.ownerUid$])
      .pipe(take(1))
      .subscribe(([isOwner, ownerUid]) => {
        if (!isOwner) {
          this.errorNotifier.showError('Você não tem permissão para editar esta foto.');
          return;
        }

        if (!item.id?.trim() || !item.path?.trim() || !item.url?.trim()) {
          this.errorNotifier.showError('Metadados insuficientes para editar esta foto.');
          return;
        }

        this.photoEditorSession.setEditDraft({
          ownerUid,
          photoId: item.id,
          storedImageUrl: item.url,
          storedImagePath: item.path,
          storedImageState: null,
          fileName: item.fileName ?? item.alt ?? null,
        });

        const modalRef = this.modal.open(PhotoEditorComponent, {
          size: 'xl',
          centered: true,
          backdrop: 'static',
          keyboard: false,
          scrollable: true,
          windowClass: 'photo-editor-modal-window',
        });

        modalRef.result
          .then((payload) => {
            if (!payload || payload.reason !== 'updateSuccess' || !payload.photo) {
              return;
            }

            this.errorNotifier.showSuccess('Foto atualizada com sucesso.');
          })
          .catch(() => {
            // dismiss do modal: sem erro visível
          })
          .finally(() => {
            this.photoEditorSession.clearDraft();
          });
      });
  }

  requestDelete(item: IPhotoCardVm, event?: Event): void {
    event?.stopPropagation();
    this.confirmDeleteIdSubject.next(item.id);
  }

  cancelDelete(event?: Event): void {
    event?.stopPropagation();
    this.confirmDeleteIdSubject.next(null);
  }

  confirmDelete(item: IPhotoCardVm, event?: Event): void {
    event?.stopPropagation();

    combineLatest([this.isOwner$, this.ownerUid$, this.deletingPhotoId$])
      .pipe(take(1))
      .subscribe(([isOwner, ownerUid, deletingPhotoId]) => {
        if (!isOwner) {
          this.errorNotifier.showError('Você não tem permissão para excluir esta foto.');
          return;
        }

        if (deletingPhotoId === item.id) {
          return;
        }

        if (!item.id?.trim() || !item.path?.trim()) {
          this.errorNotifier.showWarning('Metadados insuficientes para excluir esta foto.');
          return;
        }

        this.deletingPhotoIdSubject.next(item.id);

        from(this.photoFirestoreService.deletePhoto(ownerUid, item.id, item.path))
          .pipe(
            finalize(() => {
              this.deletingPhotoIdSubject.next(null);
              this.confirmDeleteIdSubject.next(null);
            }),
            catchError((error) => {
              this.reportError(
                'Erro ao excluir a foto.',
                error,
                {
                  op: 'confirmDelete',
                  ownerUid,
                  photoId: item.id,
                  photoPath: item.path,
                }
              );
              return EMPTY;
            })
          )
          .subscribe(() => {
            this.errorNotifier.showSuccess('Foto excluída com sucesso.');
          });
      });
  }

  publishPhoto(item: IPhotoCardVm, event?: Event): void {
    event?.stopPropagation();

    if (!this.publicationFeatureReady) {
      this.errorNotifier.showWarning('Publique as rules da camada photo_publications/public_profiles antes de habilitar esta ação.');
      return;
    }

    this.ownerUid$.pipe(take(1)).subscribe((ownerUid) => {
      this.publishingPhotoIdSubject.next(item.id);

      this.mediaPublicationService.publishPhoto$({
        ownerUid,
        photo: {
          id: item.id,
          ownerUid,
          url: item.url,
          alt: item.alt,
          createdAt: item.createdAt ?? Date.now(),
          path: item.path,
          fileName: item.fileName,
        },
        visibility: 'PUBLIC',
        isCover: !!item.publication.isCover,
        orderIndex: item.publication.orderIndex ?? 0,
        commentsEnabled: true,
        reactionsEnabled: false,
      })
      .pipe(finalize(() => this.publishingPhotoIdSubject.next(null)))
      .subscribe(() => {
        this.errorNotifier.showSuccess('Foto publicada com sucesso.');
      });
    });
  }

  unpublishPhoto(item: IPhotoCardVm, event?: Event): void {
    event?.stopPropagation();

    if (!this.publicationFeatureReady) {
      this.errorNotifier.showWarning('Publique as rules da camada photo_publications/public_profiles antes de habilitar esta ação.');
      return;
    }

    this.ownerUid$.pipe(take(1)).subscribe((ownerUid) => {
      this.publishingPhotoIdSubject.next(item.id);

      this.mediaPublicationService.unpublishPhoto$(ownerUid, item.id)
        .pipe(finalize(() => this.publishingPhotoIdSubject.next(null)))
        .subscribe(() => {
          this.errorNotifier.showSuccess('Foto despublicada com sucesso.');
        });
    });
  }

  setCoverPhoto(item: IPhotoCardVm, event?: Event): void {
    event?.stopPropagation();

    if (!this.publicationFeatureReady) {
      this.errorNotifier.showWarning('Publique as rules da camada photo_publications/public_profiles antes de habilitar esta ação.');
      return;
    }

    this.ownerUid$.pipe(take(1)).subscribe((ownerUid) => {
      this.publishingPhotoIdSubject.next(item.id);

      this.mediaPublicationService.setCoverPhoto$(ownerUid, item.id)
        .pipe(finalize(() => this.publishingPhotoIdSubject.next(null)))
        .subscribe(() => {
          this.errorNotifier.showSuccess('Foto de capa atualizada.');
        });
    });
  }

  private reportError(
    userMessage: string,
    error: unknown,
    context?: Record<string, unknown>
  ): void {
    try {
      this.errorNotifier.showError(userMessage);
    } catch {
      // noop
    }

    try {
      const err = error instanceof Error ? error : new Error(userMessage);
      (err as any).original = error;
      (err as any).context = {
        scope: 'ProfilePhotosComponent',
        ...(context ?? {}),
      };
      (err as any).skipUserNotification = true;
      this.errorHandler.handleError(err);
    } catch {
      // noop
    }

    this.debug('reportError', { userMessage, context, error });
  }
}