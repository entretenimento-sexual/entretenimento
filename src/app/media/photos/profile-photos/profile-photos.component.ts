// src/app/media/photos/profile-photos/profile-photos.component.ts
// Galeria de gestão do próprio perfil.
//
// Responsabilidades:
// - listar publicações ativas; o original privado não é autoridade da galeria;
// - permitir edição, exclusão, publicação e capa;
// - manter a edição visual desacoplada da persistência: o editor devolve um
//   arquivo processado e este componente executa a substituição da foto.
//
// users/{uid}/photos é somente compatibilidade legada para metadados opcionais.
// Edição e substituição são autorizadas pela publicação final vigente.

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';

import { BehaviorSubject, EMPTY, Observable, combineLatest, from, of } from 'rxjs';
import {
  catchError,
  filter,
  distinctUntilChanged,
  finalize,
  map,
  shareReplay,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import { IPhotoPublicationConfig } from 'src/app/core/interfaces/media/i-photo-publication-config';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { MediaApplicationErrorService } from 'src/app/core/services/media/media-application-error.service';
import type { MediaErrorReason } from 'src/app/core/services/media/media-error.catalog';
import { PhotoEditorLauncherService } from 'src/app/core/services/image-handling/photo-editor-launcher.service';
import { PhotoFirestoreService } from 'src/app/core/services/image-handling/photo-firestore.service';
import { PublishedPhotoReplacementService } from 'src/app/core/services/image-handling/published-photo-replacement.service';
import { MediaPolicyService, IMediaPolicyResult } from 'src/app/core/services/media/media-policy.service';
import { MediaPublicationService } from 'src/app/core/services/media/media-publication.service';
import { MediaQueryService } from 'src/app/core/services/media/media-query.service';
import { filterPublishedProfilePhotos } from 'src/app/core/services/media/profile-published-photo-filter.policy';
import { OwnerPublishedPhotoGalleryService } from 'src/app/core/services/media/owner-published-photo-gallery.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';

import type { IProfilePhotoItem } from '../photo-viewer/photo-viewer.component';
import { PublicPhotoViewerLauncherService } from '../photo-viewer/public-photo-viewer-launcher.service';
import { PageHeaderComponent } from 'src/app/shared/page-header/page-header.component';
import {
  ConfirmationDialogComponent,
} from 'src/app/shared/components-globais/confirmation-dialog/confirmation-dialog.component';
import { MediaActionMenuComponent } from 'src/app/media/shared/components/media-action-menu/media-action-menu.component';
import {
  MediaDateDialogComponent,
} from 'src/app/media/shared/components/media-date-dialog/media-date-dialog.component';

type IManageablePhotoItem = IProfilePhotoItem & {
  path?: string;
  fileName?: string;
  displayDate?: number | null;
  ownerUid: string;
};

type IPhotoCardVm = IManageablePhotoItem & {
  publication: IPhotoPublicationConfig;
  /** Revisão canônica do ativo social, independente da origem privada. */
  assetVersion?: number;
  publishedAt?: number;
};

type TProfilePhotoSortMode = 'newest' | 'oldest';

const DENY_UNKNOWN: IMediaPolicyResult = { decision: 'DENY', reason: 'UNKNOWN' };

@Component({
  selector: 'app-profile-photos',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatDialogModule,
    PageHeaderComponent,
    MediaActionMenuComponent,
  ],
  providers: [OwnerPublishedPhotoGalleryService],
  templateUrl: './profile-photos.component.html',
  styleUrls: ['./profile-photos.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfilePhotosComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);

  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly policy = inject(MediaPolicyService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly errorHandler = inject(MediaApplicationErrorService);
  private readonly mediaQuery = inject(MediaQueryService);
  private readonly ownerGallery = inject(OwnerPublishedPhotoGalleryService);
  private readonly publicPhotoViewer = inject(PublicPhotoViewerLauncherService);
  private readonly mediaPublicationService = inject(MediaPublicationService);
  private readonly photoFirestoreService = inject(PhotoFirestoreService);
  private readonly photoEditor = inject(PhotoEditorLauncherService);
  private readonly publishedReplacement = inject(PublishedPhotoReplacementService);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);
  private readonly deletingPhotoIdSubject = new BehaviorSubject<string | null>(null);
  readonly deletingPhotoId$ = this.deletingPhotoIdSubject.asObservable();

  private readonly updatingPhotoIdSubject = new BehaviorSubject<string | null>(null);
  readonly updatingPhotoId$ = this.updatingPhotoIdSubject.asObservable();

  private readonly savingDisplayDateIdSubject = new BehaviorSubject<string | null>(null);
  readonly savingDisplayDateId$ = this.savingDisplayDateIdSubject.asObservable();

  private readonly sortModeSubject = new BehaviorSubject<TProfilePhotoSortMode>('newest');
  readonly sortMode$ = this.sortModeSubject.asObservable();

  private debug(message: string, extra?: unknown): void {
    this.privacyDebug.log('media', `ProfilePhotos: ${message}`, extra);
  }

  readonly viewerUid$: Observable<string | null> = this.currentUserStore.user$.pipe(
    map((u) => u?.uid ?? null),
    distinctUntilChanged(),
    tap((uid) =>
      this.debug('viewerUid$', {
        hasViewerUid: !!uid,
      })
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly ownerUid$: Observable<string> = combineLatest([
    this.route.paramMap.pipe(
      map((p) => p.get('id')),
      distinctUntilChanged()
    ),
    this.viewerUid$,
  ]).pipe(
    map(([routeId, viewerUid]) => routeId ?? viewerUid ?? ''),
    distinctUntilChanged(),
    tap((id) =>
      this.debug('ownerUid$', {
        hasOwnerUid: !!id,
        sameAsRouteOrSession: true,
      })
    ),
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
    this.ownerUid$,
  ]).pipe(
    switchMap(([viewer, owner]) =>
      owner ? this.policy.canViewProfilePhotos$(viewer, owner) : of(DENY_UNKNOWN)
    ),
    tap((r) => this.debug('policyResult$', r)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly canView$: Observable<boolean> = this.policyResult$.pipe(
    map((r) => r.decision === 'ALLOW'),
    distinctUntilChanged()
  );

  readonly ownerGalleryState$ = this.ownerGallery.state$;

  constructor() {
    // A listagem social é a fonte dos itens; os documentos técnicos
    // de origem servem somente às ações legadas que ainda os exigem.
    combineLatest([this.ownerUid$, this.canView$]).pipe(
      distinctUntilChanged(
        ([previousUid, previousAllowed], [uid, allowed]) =>
          previousUid === uid && previousAllowed === allowed
      ),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(([uid, allowed]) => this.ownerGallery.connect(uid, allowed));
  }

  loadMorePhotos(): void {
    this.ownerGallery.loadMorePhotos();
  }

  retryPhotos(): void {
    this.ownerGallery.retry();
  }

  readonly photos$: Observable<IManageablePhotoItem[]> = combineLatest([
    this.ownerUid$,
    this.canView$,
  ]).pipe(
    switchMap(([ownerUid, canView]) => {
      if (!ownerUid || !canView) return of([] as IManageablePhotoItem[]);
      return this.mediaQuery.watchProfilePhotos$(ownerUid);
    }),
    tap((items) => this.debug('photos$', { count: items.length })),
    catchError((error) => {
      this.errorHandler.report(error, {
        operation: 'profilePhotos.load',
        reasonHint: 'profile_photos_load_failed',
        metadata: { scope: 'ProfilePhotosComponent' },
      });
      return of([] as IManageablePhotoItem[]);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly publicationConfigs$: Observable<Record<string, IPhotoPublicationConfig>> =
    combineLatest([this.ownerUid$, this.isOwner$]).pipe(
      switchMap(([ownerUid, isOwner]) => {
        if (!ownerUid || !isOwner) return of({});
        return this.mediaPublicationService.getPublicationConfigsByOwner$(ownerUid);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly photoCards$: Observable<IPhotoCardVm[]> = combineLatest([
    this.ownerUid$,
    this.ownerGalleryState$,
    this.photos$,
    this.publicationConfigs$,
    this.sortMode$,
  ]).pipe(
    map(([ownerUid, gallery, originPhotos, publicationConfigs, sortMode]) => {
      if (gallery.ownerUid !== ownerUid) return [];

      const originById = new Map(
        filterPublishedProfilePhotos(originPhotos, publicationConfigs, ownerUid)
          .map((photo) => [photo.id, photo])
      );
      const cards: IPhotoCardVm[] = gallery.items.map((photo) => {
        const origin = originById.get(photo.id);
        const storedConfig = publicationConfigs[photo.id];
        const publication: IPhotoPublicationConfig =
          storedConfig?.ownerUid === ownerUid && storedConfig.isPublished
            ? storedConfig
            : {
                ...this.mediaPublicationService.buildDefaultConfig(ownerUid, photo.id),
                isPublished: true,
                visibility: photo.visibility,
                moderationStatus: photo.moderationStatus ?? 'APPROVED',
                isCover: photo.isCover === true,
                orderIndex: photo.orderIndex,
                publishedAt: photo.publishedAt,
              };

        return {
          ...photo,
          // Caminho de origem opcional: publicação pública nunca expõe upload privado.
          path: origin?.path,
          fileName: origin?.fileName,
          displayDate: origin?.displayDate,
          publication,
        };
      });

      return this.sortPhotoCards(cards, sortMode);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly isEmpty$: Observable<boolean> = this.photoCards$.pipe(
    map((items) => items.length === 0),
    distinctUntilChanged()
  );

  readonly totalPhotos$: Observable<number> = this.photoCards$.pipe(
    map((items) => items.length),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  setSortMode(mode: TProfilePhotoSortMode): void {
    this.sortModeSubject.next(mode);
  }

  getSortModeSnapshot(): TProfilePhotoSortMode {
    return this.sortModeSubject.value;
  }

  getPhotoDateLabel(item: IPhotoCardVm): string {
    const effectiveDate =
      this.toMillis(item.displayDate) || this.toMillis(item.createdAt);

    if (!effectiveDate) {
      return '';
    }

    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(effectiveDate));
  }

  getDisplayDateInputValue(item: IPhotoCardVm): string {
    const effectiveDate =
      this.toMillis(item.displayDate) || this.toMillis(item.createdAt);

    if (!effectiveDate) {
      return '';
    }

    const date = new Date(effectiveDate);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  editPhotoDate(item: IPhotoCardVm): void {
    combineLatest([this.isOwner$, this.ownerUid$, this.savingDisplayDateId$])
      .pipe(
        take(1),
        switchMap(([isOwner, ownerUid, savingDisplayDateId]) => {
          if (!isOwner || !ownerUid?.trim() || savingDisplayDateId === item.id) {
            return EMPTY;
          }

          if (!item.id?.trim()) {
            this.errorNotifier.showWarning(
              'Metadados insuficientes para atualizar a data.'
            );
            return EMPTY;
          }

          const dialogRef = this.dialog.open(MediaDateDialogComponent, {
            data: { value: this.getDisplayDateInputValue(item) },
            autoFocus: 'dialog',
            restoreFocus: true,
            ariaLabel: 'Alterar data da foto',
            maxWidth: 'min(92vw, 420px)',
          });

          return dialogRef.afterClosed().pipe(
            filter((value) => value !== undefined),
            switchMap((value) => {
              const nextDisplayDate = value
                ? this.parseDateInputValue(value)
                : null;

              if (value && nextDisplayDate === null) {
                this.errorNotifier.showWarning('Informe uma data válida.');
                return EMPTY;
              }

              this.savingDisplayDateIdSubject.next(item.id);

              return from(
                this.photoFirestoreService.updatePhotoDisplayDate(
                  ownerUid,
                  item.id,
                  nextDisplayDate
                )
              ).pipe(
                tap(() => this.errorNotifier.showSuccess('Data atualizada.')),
                catchError((error) => {
                  this.reportError(
                    'media_publication_failed',
                    error,
                    {
                      op: 'editPhotoDate',
                      ownerUid,
                      photoId: item.id,
                    }
                  );
                  return EMPTY;
                }),
                finalize(() => this.savingDisplayDateIdSubject.next(null))
              );
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private sortPhotoCards(
    items: readonly IPhotoCardVm[],
    mode: TProfilePhotoSortMode
  ): IPhotoCardVm[] {
    return [...items].sort((a, b) => {
      const aSortDate = this.getPhotoSortDate(a);
      const bSortDate = this.getPhotoSortDate(b);

      return mode === 'oldest'
        ? aSortDate - bSortDate
        : bSortDate - aSortDate;
    });
  }

  private getPhotoSortDate(item: IPhotoCardVm): number {
    return this.toMillis(item.displayDate) || this.toMillis(item.createdAt);
  }

  private toMillis(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (value instanceof Date) {
      return value.getTime();
    }

    const maybeTimestamp = value as { toMillis?: () => number } | null | undefined;

    if (typeof maybeTimestamp?.toMillis === 'function') {
      return maybeTimestamp.toMillis();
    }

    return 0;
  }

  private parseDateInputValue(value: string): number | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

    if (!match) {
      return null;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
      return null;
    }

    if (year < 1970 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
      return null;
    }

    const date = new Date(year, month - 1, day, 12, 0, 0, 0);

    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }

    return date.getTime();
  }

  openUpload(ownerUid: string): void {
    this.router.navigate(['/media', 'perfil', ownerUid, 'fotos', 'upload']).catch((error) => {
      this.errorHandler.report(error, {
        operation: 'profilePhotos.openUpload',
        reasonHint: 'media_navigation_failed',
        metadata: {
          scope: 'ProfilePhotosComponent',
          hasOwnerUid: !!ownerUid,
        },
      });
    });
  }

  openPhoto(targetId: string): void {
    combineLatest([this.canView$, this.ownerUid$, this.ownerGalleryState$])
      .pipe(
        take(1),
        switchMap(([canView, ownerUid, gallery]) => {
          if (!canView || gallery.ownerUid !== ownerUid) {
            this.errorNotifier.showWarning('Você não tem permissão para ver essas fotos.');
            return EMPTY;
          }

          const selected = gallery.items.find(
            (item) => item.id === targetId && item.ownerUid === ownerUid
          );
          if (!selected) return EMPTY;

          return this.publicPhotoViewer.open$({
            items: [...gallery.items],
            selected,
            source: 'profile',
          });
        }),
        catchError((error) => {
          this.errorHandler.report(error, {
            operation: 'profilePhotos.openPhoto',
            reasonHint: 'media_navigation_failed',
            metadata: { scope: 'ProfilePhotosComponent' },
          });
          return EMPTY;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  editPhoto(item: IPhotoCardVm, event?: Event): void {
    event?.stopPropagation();

    combineLatest([this.isOwner$, this.ownerUid$])
      .pipe(
        take(1),
        switchMap(([isOwner, ownerUid]) => {
          if (!isOwner) {
            this.errorNotifier.showWarning('Você não tem permissão para editar esta foto.');
            return EMPTY;
          }

          const photoId = String(item.id ?? '').trim();
          const storedImageUrl = String(item.url ?? '').trim();
          const expectedAssetVersion = Number(item.assetVersion ?? item.publishedAt);

          if (!photoId || !storedImageUrl ||
              !Number.isSafeInteger(expectedAssetVersion) || expectedAssetVersion <= 0) {
            this.errorNotifier.showWarning('Metadados insuficientes para editar esta foto.');
            return EMPTY;
          }

          return this.photoEditor.editStoredPhoto$({
            ownerUid,
            storedImageUrl,
            storedImageState: null,
            fileName: item.fileName ?? item.alt ?? null,
          }).pipe(
            switchMap((result) => {
              if (!result) {
                return EMPTY;
              }

              return this.publishedReplacement.replace$({
                ownerUid,
                photoId,
                expectedAssetVersion,
                processedFile: result.file,
              });
            }),
            tap(() => {
              this.ownerGallery.refresh();
              this.errorNotifier.showSuccess('Foto publicada atualizada com sucesso.');
            }),
            catchError((error) => {
              this.reportError(
                'media_replace_failed',
                error,
                {
                  op: 'editPhoto',
                  ownerUid,
                  photoId,
                }
              );
              return EMPTY;
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  requestDelete(item: IPhotoCardVm, event?: Event): void {
    event?.stopPropagation();

    combineLatest([this.isOwner$, this.ownerUid$, this.deletingPhotoId$])
      .pipe(
        take(1),
        switchMap(([isOwner, ownerUid, deletingPhotoId]) => {
          if (!isOwner || !ownerUid?.trim()) {
            this.errorNotifier.showWarning(
              'Você não tem permissão para excluir esta foto.'
            );
            return EMPTY;
          }

          if (!item.id?.trim() || deletingPhotoId === item.id) {
            return EMPTY;
          }

          const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
            data: {
              title: 'Excluir foto?',
              message: 'Esta ação remove a foto do seu perfil.',
              detail: 'A exclusão não pode ser desfeita.',
              confirmLabel: 'Excluir foto',
              cancelLabel: 'Cancelar',
              tone: 'danger',
            },
            autoFocus: 'first-tabbable',
            restoreFocus: true,
            ariaLabel: 'Confirmar exclusão da foto',
            maxWidth: 'min(92vw, 440px)',
          });

          return dialogRef.afterClosed().pipe(
            filter((confirmed) => confirmed === true),
            switchMap(() => {
              this.deletingPhotoIdSubject.next(item.id);

              return from(
                this.photoFirestoreService.deletePhoto(ownerUid, item.id)
              ).pipe(
                tap(() => {
                  this.errorNotifier.showSuccess('Foto excluída.');
                  this.ownerGallery.refresh();
                }),
                catchError((error) => {
                  this.reportError(
                    'photo_delete_failed',
                    error,
                    {
                      op: 'requestDelete',
                      ownerUid,
                      photoId: item.id,
                    }
                  );
                  return EMPTY;
                }),
                finalize(() => this.deletingPhotoIdSubject.next(null))
              );
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private canManagePhoto$(): Observable<{
    canManage: boolean;
    ownerUid: string;
  }> {
    return combineLatest([this.isOwner$, this.ownerUid$]).pipe(
      take(1),
      map(([isOwner, ownerUid]) => ({
        canManage: !!isOwner && !!ownerUid?.trim(),
        ownerUid: ownerUid ?? '',
      }))
    );
  }

  setCoverPhoto(item: IPhotoCardVm, event?: Event): void {
    event?.stopPropagation();

    this.canManagePhoto$()
      .pipe(
        switchMap(({ canManage, ownerUid }) => {
          if (!canManage) {
            this.errorNotifier.showWarning('Você não tem permissão para definir capa.');
            return EMPTY;
          }

          if (!item.id?.trim()) {
            this.errorNotifier.showWarning('Metadados insuficientes para definir capa.');
            return EMPTY;
          }

          this.updatingPhotoIdSubject.next(item.id);

          return this.mediaPublicationService.setCoverPhoto$(ownerUid, item.id).pipe(
            tap(() => {
              this.errorNotifier.showSuccess('Foto de capa atualizada.');
              this.ownerGallery.refresh();
            }),
            catchError((error) => {
              this.reportError(
                'media_publication_failed',
                error,
                {
                  op: 'setCoverPhoto',
                  ownerUid,
                  photoId: item.id,
                }
              );
              return EMPTY;
            }),
            finalize(() => this.updatingPhotoIdSubject.next(null))
          );
        })
      )
      .subscribe();
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
        scope: 'ProfilePhotosComponent',
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

}
