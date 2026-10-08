// src/app/media/photos/photo-upload/photo-upload.component.ts
// Fluxo reativo de seleção, edição canônica e envio de fotos do perfil.
// O editor apenas processa a imagem; a persistência pertence a este fluxo.

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { BehaviorSubject, EMPTY, Observable, combineLatest, from, of, throwError } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  finalize,
  map,
  shareReplay,
  switchMap,
  take,
  tap,
  filter,
  takeUntil,
} from 'rxjs/operators';

import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { MediaApplicationErrorService } from 'src/app/core/services/media/media-application-error.service';
import { MediaPublicationService } from 'src/app/core/services/media/media-publication.service';
import { resolveMediaPolicyDeniedMessage } from 'src/app/core/services/media/media-policy-feedback.policy';
import type { TPhotoPublishableVisibility } from 'src/app/core/interfaces/media/i-photo-publication-config';
import type { MediaErrorReason } from 'src/app/core/services/media/media-error.catalog';
import { PhotoEditorLauncherService } from 'src/app/core/services/image-handling/photo-editor-launcher.service';
import { PhotoFirestoreService } from 'src/app/core/services/image-handling/photo-firestore.service';
import {
  IPhotoUploadFlowEvent,
  PhotoUploadFlowService,
} from 'src/app/core/services/image-handling/photo-upload-flow.service';
import {
  MEDIA_IMAGE_ACCEPT,
  MEDIA_IMAGE_FORMAT_LABEL,
  resolveImageMaxBytes,
  validateImageMediaFile,
} from 'src/app/core/services/media/media-format.policy';
import {
  IMediaPolicyResult,
  IMediaPolicyViewerSnapshot,
  MediaPolicyService,
} from 'src/app/core/services/media/media-policy.service';
import { environment } from 'src/environments/environment';
import { PageHeaderComponent } from 'src/app/shared/page-header/page-header.component';

const DENY_UNKNOWN: IMediaPolicyResult = { decision: 'DENY', reason: 'UNKNOWN' };

type UploadPhase = 'IDLE' | 'EDITING' | 'READY' | 'UPLOADING';
type PhotoUploadAudience = TPhotoPublishableVisibility;

@Component({
  selector: 'app-photo-upload',
  standalone: true,
  imports: [CommonModule, RouterModule, PageHeaderComponent],
  templateUrl: './photo-upload.component.html',
  styleUrls: ['./photo-upload.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhotoUploadComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly authSession = inject(AuthSessionService);
  private readonly policy = inject(MediaPolicyService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly errorHandler = inject(MediaApplicationErrorService);
  private readonly photoUploadFlow = inject(PhotoUploadFlowService);
  private readonly photoFirestore = inject(PhotoFirestoreService);
  private readonly mediaPublication = inject(MediaPublicationService);
  private readonly photoEditor = inject(PhotoEditorLauncherService);

  private readonly DEBUG =
    !environment.production &&
    localStorage.getItem('debug.photo-upload') === '1';

  readonly imageAccept = MEDIA_IMAGE_ACCEPT;
  readonly imageFormatLabel = MEDIA_IMAGE_FORMAT_LABEL;
  readonly imageMaxMegabytes = resolveImageMaxBytes('default') / 1024 / 1024;

  constructor() {
    this.destroyRef.onDestroy(() => this.revokePreviewUrl());
    // Um arquivo selecionado também é dado privado: descarte ao trocar
    // identidade ou navegar para outro perfil, mesmo antes do upload.
    combineLatest([this.authSession.uid$, this.ownerUid$]).pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(([uid, ownerUid]) => {
      if (uid !== ownerUid) {
        this.discardSessionDraft();
      }
    });
  }

  readonly ownerUid$: Observable<string> = this.route.paramMap.pipe(
    map((p) => p.get('id') ?? ''),
    distinctUntilChanged(),
    tap((id) => this.debug('ownerUid$', id)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly viewer$: Observable<IMediaPolicyViewerSnapshot | null | undefined> =
    this.currentUserStore.user$.pipe(
      map((user) =>
        user
          ? {
              uid: user.uid,
              emailVerified: user.emailVerified === true,
              profileCompleted: user.profileCompleted === true,
              interactionBlocked: user.interactionBlocked === true,
            }
          : user
      ),
      distinctUntilChanged((previous, current) =>
        previous === current ||
        (!!previous &&
          !!current &&
          previous.uid === current.uid &&
          previous.emailVerified === current.emailVerified &&
          previous.profileCompleted === current.profileCompleted &&
          previous.interactionBlocked === current.interactionBlocked)
      ),
      tap((viewer) =>
        this.debug('viewer$', {
          resolved: viewer !== undefined,
          hasViewerUid: !!viewer?.uid,
          emailVerified: viewer?.emailVerified === true,
          profileCompleted: viewer?.profileCompleted === true,
          interactionBlocked: viewer?.interactionBlocked === true,
        })
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly viewerUid$: Observable<string | null> = this.viewer$.pipe(
    map((u) => u?.uid ?? null),
    distinctUntilChanged(),
    tap((uid) => this.debug('viewerUid$', uid)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly policyResult$: Observable<IMediaPolicyResult> = combineLatest([
    this.viewer$,
    this.ownerUid$,
  ]).pipe(
    switchMap(([viewer, owner]) =>
      owner
        ? this.policy.canUploadProfilePhotosForViewer$(viewer, owner)
        : of(DENY_UNKNOWN)
    ),
    tap((r) => this.debug('policyResult$', r)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly canUpload$: Observable<boolean> = this.policyResult$.pipe(
    map((r) => r.decision === 'ALLOW'),
    distinctUntilChanged()
  );

  private readonly fileSubject = new BehaviorSubject<File | null>(null);
  readonly file$: Observable<File | null> = this.fileSubject.asObservable();

  private readonly imageStateSubject = new BehaviorSubject<string | null>(null);
  readonly imageState$: Observable<string | null> = this.imageStateSubject.asObservable();

  private readonly previewUrlSubject = new BehaviorSubject<string | null>(null);
  readonly previewUrl$: Observable<string | null> =
    this.previewUrlSubject.asObservable();

  private readonly phaseSubject = new BehaviorSubject<UploadPhase>('IDLE');
  readonly phase$: Observable<UploadPhase> = this.phaseSubject.asObservable();

  private readonly audienceSubject = new BehaviorSubject<PhotoUploadAudience | null>(null);
  readonly audience$: Observable<PhotoUploadAudience | null> =
    this.audienceSubject.asObservable();

  private readonly uploadPercentSubject = new BehaviorSubject<number>(0);
  readonly uploadPercent$: Observable<number> =
    this.uploadPercentSubject.asObservable();

  readonly selectedFileName$: Observable<string | null> = this.file$.pipe(
    map((file) => file?.name ?? null),
    distinctUntilChanged()
  );

  readonly selectedFileSizeLabel$: Observable<string | null> = this.file$.pipe(
    map((file) => (file ? this.formatBytes(file.size) : null)),
    distinctUntilChanged()
  );

  onFileSelected(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;

    if (!file) {
      return;
    }

    input.value = '';

    const validation = validateImageMediaFile(file, 'default');
    if (!validation.valid) {
      this.errorNotifier.showWarning(
        validation.userMessage ?? 'A imagem selecionada não é válida.'
      );
      return;
    }

    combineLatest([this.policyResult$, this.ownerUid$, this.phase$])
      .pipe(
        take(1),
        tap(([policyResult, ownerUid, phase]) => {
          if (phase === 'UPLOADING' || phase === 'EDITING') {
            return;
          }

          if (policyResult.decision !== 'ALLOW') {
            this.errorNotifier.showWarning(
              resolveMediaPolicyDeniedMessage(policyResult.reason, 'upload-photo')
            );
            return;
          }

          if (!ownerUid?.trim()) {
            this.reportReason(
              'photo_upload_failed',
              { op: 'onFileSelected.ownerUid' }
            );
            return;
          }

          this.applySelectedFile(file, null);
          this.debug('fileSelectedForPreview', {
            name: file.name,
            type: file.type,
            size: file.size,
          });
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  startUpload(): void {
    combineLatest([
      this.policyResult$,
      this.file$,
      this.ownerUid$,
      this.phase$,
      this.imageState$,
      this.audience$,
    ])
      .pipe(
        take(1),
        switchMap(([policyResult, file, ownerUid, phase, imageStateStr, audience]) => {
          if (phase === 'UPLOADING' || phase === 'EDITING') {
            return EMPTY;
          }

          if (policyResult.decision !== 'ALLOW') {
            this.errorNotifier.showWarning(
              resolveMediaPolicyDeniedMessage(policyResult.reason, 'upload-photo')
            );
            return EMPTY;
          }

          if (!ownerUid?.trim()) {
            this.reportReason(
              'photo_upload_failed',
              { op: 'startUpload.ownerUid' }
            );
            return EMPTY;
          }

          if (!file) {
            this.errorNotifier.showWarning('Selecione uma imagem antes de enviar.');
            return EMPTY;
          }

          if (!audience) {
            this.errorNotifier.showWarning('Escolha quem poderá ver esta foto.');
            return EMPTY;
          }

          this.phaseSubject.next('UPLOADING');
          this.uploadPercentSubject.next(0);

          return this.uploadSelectedFile$(
            ownerUid,
            file,
            audience,
            imageStateStr ?? undefined
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  editBeforeUpload(event: MouseEvent): void {
    if (!event.isTrusted) {
      this.debug('editBeforeUpload.ignoredNonUserGesture');
      return;
    }

    combineLatest([this.policyResult$, this.file$, this.ownerUid$, this.phase$])
      .pipe(
        take(1),
        switchMap(([policyResult, file, ownerUid, phase]) => {
          if (phase !== 'READY') {
            return EMPTY;
          }

          if (policyResult.decision !== 'ALLOW') {
            this.errorNotifier.showWarning(
              resolveMediaPolicyDeniedMessage(policyResult.reason, 'edit-photo')
            );
            return EMPTY;
          }

          if (!ownerUid?.trim()) {
            this.reportReason(
              'photo_upload_failed',
              { op: 'editBeforeUpload.ownerUid' }
            );
            return EMPTY;
          }

          if (!file) {
            this.errorNotifier.showWarning('Selecione uma imagem antes de editar.');
            return EMPTY;
          }

          this.phaseSubject.next('EDITING');

          return this.photoEditor
            .editFile$(file, {
              source: 'photo-upload',
              context: 'profile-photo',
              preset: 'profile-photo',
            })
            .pipe(
              tap((result) => {
                if (!result) {
                  return;
                }

                const validation = validateImageMediaFile(result.file, 'default');
                if (!validation.valid) {
                  this.errorNotifier.showWarning(
                    validation.userMessage ?? 'A imagem editada não é válida.'
                  );
                  return;
                }

                this.applySelectedFile(result.file, result.imageStateStr);
              }),
              catchError((error) => {
                this.reportError('photo_editor_failed', error, {
                  op: 'editBeforeUpload.editor',
                  ownerUid,
                  fileName: file.name,
                });
                return EMPTY;
              }),
              takeUntil(this.authSession.uid$.pipe(filter((uid) => uid !== ownerUid))),
              takeUntil(this.ownerUid$.pipe(filter((uid) => uid !== ownerUid))),
              finalize(() => {
                if (this.phaseSubject.value === 'EDITING') {
                  this.phaseSubject.next('READY');
                }
              })
            );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private discardSessionDraft(): void {
    if (
      !this.fileSubject.value &&
      this.phaseSubject.value === 'IDLE'
    ) return;

    this.revokePreviewUrl();
    this.fileSubject.next(null);
    this.imageStateSubject.next(null);
    this.previewUrlSubject.next(null);
    this.phaseSubject.next('IDLE');
    this.audienceSubject.next(null);
    this.uploadPercentSubject.next(0);
  }

  resetSelection(fileInput?: HTMLInputElement): void {
    if (this.phaseSubject.value === 'UPLOADING' || this.phaseSubject.value === 'EDITING') {
      return;
    }

    this.revokePreviewUrl();
    this.fileSubject.next(null);
    this.imageStateSubject.next(null);
    this.previewUrlSubject.next(null);
    this.phaseSubject.next('IDLE');
    this.audienceSubject.next(null);
    this.uploadPercentSubject.next(0);

    if (fileInput) {
      fileInput.value = '';
    }
  }

  private uploadSelectedFile$(
    ownerUid: string,
    file: File,
    audience: PhotoUploadAudience,
    imageStateStr?: string
  ): Observable<IPhotoUploadFlowEvent> {
    let publicationFailed = false;

    return this.photoUploadFlow.uploadProcessedPhotoWithProgress$({
      userId: ownerUid,
      processedFile: file,
      originalFileName: file.name,
      mimeType: file.type,
      imageStateStr,
    }).pipe(
      tap((event) => {
        if (event.type === 'progress') {
          this.uploadPercentSubject.next(event.progress);
        }
      }),
      switchMap((event) => {
        if (event.type === 'progress') {
          return of(event);
        }

        const result = event.result;

        return this.mediaPublication.publishPhoto$({
          ownerUid,
          photo: {
            id: result.photoId,
            ownerUid,
            url: result.url,
            alt: result.fileName,
            createdAt: result.createdAt.getTime(),
            path: result.path,
            fileName: result.fileName,
          },
          visibility: audience,
          isCover: false,
          orderIndex: 0,
          commentsEnabled: true,
          commentsPolicy: audience === 'FRIENDS' ? 'FRIENDS' : 'EVERYONE',
          reactionsEnabled: true,
        }).pipe(
          map(() => event),
          catchError((error) => {
            publicationFailed = true;
            this.errorHandler.report(error, {
              operation: 'photoUpload.publishAfterUpload',
              reasonHint: 'media_publication_failed',
              silent: true,
              metadata: {
                scope: 'PhotoUploadComponent',
                ownerUid,
                photoId: result.photoId,
                audience,
              },
            });

            return from(
              this.photoFirestore.deletePhoto(ownerUid, result.photoId)
            ).pipe(
              catchError((cleanupError) => {
                this.errorHandler.report(cleanupError, {
                  operation: 'photoUpload.rollbackFailedPublication',
                  reasonHint: 'photo_delete_failed',
                  silent: true,
                  metadata: {
                    scope: 'PhotoUploadComponent',
                    ownerUid,
                    photoId: result.photoId,
                  },
                });
                return of(void 0);
              }),
              switchMap(() => throwError(() => error))
            );
          })
        );
      }),
      tap((event) => {
        if (event.type === 'progress') {
          return;
        }

        this.debug('uploadSuccess', event.result);
        this.uploadPercentSubject.next(100);
        if (!publicationFailed) {
          this.errorNotifier.showSuccess(
            audience === 'FRIENDS'
              ? 'Foto publicada para amigos.'
              : 'Foto publicada para todos.'
          );
        }

        this.router
          .navigate(['/media', 'perfil', ownerUid, 'fotos'])
          .catch((navigationError) => {
            this.phaseSubject.next('READY');
            this.reportError(
              'media_navigation_failed',
              navigationError,
              { op: 'uploadSelectedFile.navigateBack', ownerUid }
            );
          });
      }),
      catchError((error) => {
        this.phaseSubject.next('READY');
        this.uploadPercentSubject.next(0);
        this.reportError(
          'photo_upload_failed',
          error,
          {
            op: 'uploadSelectedFile',
            ownerUid,
            fileName: file.name,
          }
        );
        return EMPTY;
      }),
      takeUntil(this.authSession.uid$.pipe(filter((uid) => uid !== ownerUid))),
      takeUntil(this.ownerUid$.pipe(filter((uid) => uid !== ownerUid))),
      finalize(() => {
        if (this.currentUserStore.getLoggedUserUIDSnapshot() !== ownerUid) {
          // Não manter o arquivo selecionado nem a prévia de A após logout.
          this.discardSessionDraft();
        }
      })
    );
  }

  selectAudience(audience: PhotoUploadAudience): void {
    if (this.phaseSubject.value === 'UPLOADING' || this.phaseSubject.value === 'EDITING') {
      return;
    }

    this.audienceSubject.next(audience);
  }

  private applySelectedFile(
    file: File,
    imageStateStr: string | null
  ): void {
    this.revokePreviewUrl();

    let previewUrl: string | null = null;
    try {
      previewUrl = URL.createObjectURL(file);
    } catch {
      previewUrl = null;
    }

    this.fileSubject.next(file);
    this.imageStateSubject.next(imageStateStr);
    this.previewUrlSubject.next(previewUrl);
    this.phaseSubject.next('READY');
    this.uploadPercentSubject.next(0);
  }

  private revokePreviewUrl(): void {
    const previous = this.previewUrlSubject.value;
    if (previous?.startsWith('blob:')) {
      URL.revokeObjectURL(previous);
    }
  }

  private formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return '0 B';
    }

    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(
      Math.floor(Math.log(bytes) / Math.log(1024)),
      units.length - 1
    );
    const value = bytes / Math.pow(1024, index);

    return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
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
        scope: 'PhotoUploadComponent',
        ...(context ?? {}),
      },
    });

    this.debug('reportError', { reasonHint, context, error });
  }

  private reportReason(
    reasonHint: MediaErrorReason,
    context?: Record<string, unknown>
  ): void {
    this.errorHandler.reportReason(reasonHint, {
      operation: String(context?.['op'] ?? 'unknown'),
      metadata: {
        scope: 'PhotoUploadComponent',
        ...(context ?? {}),
      },
    });

    this.debug('reportReason', { reasonHint, context });
  }

  private debug(msg: string, data?: unknown): void {
    if (!this.DEBUG) {
      return;
    }

    // eslint-disable-next-line no-console
    console.debug(`[PhotoUpload] ${msg}`, data ?? '');
  }
}
