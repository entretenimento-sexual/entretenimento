// src/app/media/videos/profile-videos/profile-videos.component.ts
// -----------------------------------------------------------------------------
// Upload temporário, processamento e publicação controlada de vídeos.
// -----------------------------------------------------------------------------

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  BehaviorSubject,
  EMPTY,
  Observable,
  Subscription,
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

import { IVideoItem } from 'src/app/core/interfaces/media/i-video-item';
import {
  IVideoPublicationConfig,
  IVideoPublicationSettingsInput,
} from 'src/app/core/interfaces/media/i-video-publication-config';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import {
  IMediaPolicyResult,
  IMediaPolicyViewerSnapshot,
  MediaPolicyDenyReason,
  MediaPolicyService,
} from 'src/app/core/services/media/media-policy.service';
import { VideoLibraryService } from 'src/app/core/services/media/video-library.service';
import { VideoMetadataPreparationService } from 'src/app/core/services/media/video-metadata-preparation.service';
import { VideoPublicationService } from 'src/app/core/services/media/video-publication.service';
import {
  VIDEO_UPLOAD_ACCEPT,
  VIDEO_UPLOAD_FORMAT_LABEL,
  resolveVideoUploadFormat,
} from 'src/app/core/services/media/video-upload-format.policy';
import {
  buildVideoUploadSafetyAttestation,
} from 'src/app/core/services/media/video-upload-safety-attestation.policy';
import type {
  IVideoUploadCaptionInput,
  IVideoUploadFlowEvent,
  VideoUploadProgressPhase,
} from 'src/app/core/services/media/video-upload-flow.service';
import {
  VideoUploadFlowService,
} from 'src/app/core/services/media/video-upload-flow.service';

interface ProfileVideoViewItem {
  video: IVideoItem;
  publication: IVideoPublicationConfig | null;
}

interface VideoUploadFailureFeedback {
  title: string;
  message: string;
  recovery: string;
  retryable: boolean;
}

type VideoBusyAction = 'publish' | 'unpublish' | 'delete' | 'save';
type VideoUploadUiPhase =
  | 'IDLE'
  | 'READY'
  | 'PREPARING'
  | 'UPLOADING'
  | 'SAVING'
  | 'DONE';

const MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024;
const MAX_CAPTION_SIZE_BYTES = 1024 * 1024;
const PUBLIC_PLAYBACK_TYPES = new Set(['video/mp4', 'video/webm']);
const DENY_UNKNOWN: IMediaPolicyResult = {
  decision: 'DENY',
  reason: 'UNKNOWN',
};
const DEFAULT_CAPTION_LANGUAGE = 'pt-BR';
const DEFAULT_CAPTION_LABEL = 'Português (Brasil)';
const WEBVTT_CUE_PATTERN =
  /\d{2}:\d{2}(?::\d{2})?[.,]\d{3}\s+-->\s+\d{2}:\d{2}(?::\d{2})?[.,]\d{3}/;

@Component({
  selector: 'app-profile-videos',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './profile-videos.component.html',
  styleUrls: [
    './profile-videos.component.css',
    './profile-videos-settings.component.css',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileVideosComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly videoLibrary = inject(VideoLibraryService);
  private readonly videoPublication = inject(VideoPublicationService);
  private readonly videoUploadFlow = inject(VideoUploadFlowService);
  private readonly metadataPreparation = inject(VideoMetadataPreparationService);
  private readonly mediaPolicy = inject(MediaPolicyService);
  private readonly errorNotification = inject(ErrorNotificationService);

  readonly videoUploadAccept = VIDEO_UPLOAD_ACCEPT;
  readonly videoUploadFormatLabel = VIDEO_UPLOAD_FORMAT_LABEL;

  private readonly busyActionsSubject = new BehaviorSubject<
    ReadonlyMap<string, VideoBusyAction>
  >(new Map());
  readonly busyActions$ = this.busyActionsSubject.asObservable();

  private readonly pendingDeleteVideoIdSubject = new BehaviorSubject<
    string | null
  >(null);
  readonly pendingDeleteVideoId$ =
    this.pendingDeleteVideoIdSubject.asObservable();

  private readonly editingVideoIdSubject = new BehaviorSubject<string | null>(
    null
  );
  readonly editingVideoId$ = this.editingVideoIdSubject.asObservable();

  readonly uploadPublicationForm = this.formBuilder.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(120)]],
    description: ['', [Validators.maxLength(1000)]],
    reactionsEnabled: [true],
    commentsEnabled: [true],
    ratingsEnabled: [true],
    captionLanguage: [
      DEFAULT_CAPTION_LANGUAGE,
      [Validators.pattern(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)],
    ],
    captionLabel: [DEFAULT_CAPTION_LABEL, [Validators.maxLength(40)]],
    allParticipantsAdultsAndConsenting: [false, Validators.requiredTrue],
    rightsAndPermissionsConfirmed: [false, Validators.requiredTrue],
    prohibitedContentAcknowledged: [false, Validators.requiredTrue],
  });

  readonly publicationSettingsForm = this.formBuilder.nonNullable.group({
    title: ['', [Validators.maxLength(120)]],
    description: ['', [Validators.maxLength(1000)]],
    reactionsEnabled: [true],
    commentsEnabled: [true],
    ratingsEnabled: [true],
  });

  private readonly selectedFileSubject = new BehaviorSubject<File | null>(null);
  readonly selectedFile$ = this.selectedFileSubject.asObservable();

  private readonly previewUrlSubject = new BehaviorSubject<string | null>(null);
  readonly previewUrl$ = this.previewUrlSubject.asObservable();

  private readonly selectedPosterBlobSubject =
    new BehaviorSubject<Blob | null>(null);
  readonly selectedPosterBlob$ = this.selectedPosterBlobSubject.asObservable();

  private readonly selectedPosterUrlSubject =
    new BehaviorSubject<string | null>(null);
  readonly selectedPosterUrl$ = this.selectedPosterUrlSubject.asObservable();

  private readonly selectedCaptionFileSubject =
    new BehaviorSubject<File | null>(null);
  readonly selectedCaptionFile$ =
    this.selectedCaptionFileSubject.asObservable();

  private readonly captionValidatingSubject = new BehaviorSubject(false);
  readonly captionValidating$ = this.captionValidatingSubject.asObservable();

  private readonly capturingPosterSubject = new BehaviorSubject(false);
  readonly capturingPoster$ = this.capturingPosterSubject.asObservable();

  private readonly uploadPhaseSubject = new BehaviorSubject<VideoUploadUiPhase>(
    'IDLE'
  );
  readonly uploadPhase$ = this.uploadPhaseSubject.asObservable();

  private readonly uploadProgressSubject = new BehaviorSubject<number>(0);
  readonly uploadProgress$ = this.uploadProgressSubject.asObservable();

  private readonly uploadStepSubject = new BehaviorSubject<string>(
    'Selecione um vídeo para começar.'
  );
  readonly uploadStep$ = this.uploadStepSubject.asObservable();

  private readonly uploadFailureSubject =
    new BehaviorSubject<VideoUploadFailureFeedback | null>(null);
  readonly uploadFailure$ = this.uploadFailureSubject.asObservable();

  private uploadSubscription: Subscription | null = null;
  private cancelRequestedByUser = false;

  readonly viewer$: Observable<IMediaPolicyViewerSnapshot | null | undefined> =
    this.currentUserStore.user$.pipe(
      map((user) =>
        user
          ? {
              uid: user.uid,
              emailVerified: user.emailVerified === true,
              profileCompleted: user.profileCompleted === true,
              interactionBlocked: user.interactionBlocked === true,
              ageReverificationStatus:
                user.ageReverification?.status ?? null,
              ageReverificationResult:
                user.ageReverification?.result ?? null,
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
          previous.interactionBlocked === current.interactionBlocked &&
          previous.ageReverificationStatus ===
            current.ageReverificationStatus &&
          previous.ageReverificationResult ===
            current.ageReverificationResult)
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly viewerUid$: Observable<string | null> = this.viewer$.pipe(
    map((user) => user?.uid ?? null),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly ownerUid$: Observable<string> = combineLatest([
    this.route.paramMap.pipe(
      map((params) => params.get('id')),
      distinctUntilChanged()
    ),
    this.viewerUid$,
  ]).pipe(
    map(([routeUid, viewerUid]) => routeUid ?? viewerUid ?? ''),
    distinctUntilChanged(),
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

  readonly uploadPolicyResult$: Observable<IMediaPolicyResult> = combineLatest([
    this.viewer$,
    this.ownerUid$,
  ]).pipe(
    switchMap(([viewer, ownerUid]) =>
      ownerUid
        ? this.mediaPolicy.canUploadProfileVideosForViewer$(viewer, ownerUid)
        : of(DENY_UNKNOWN)
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly canUpload$ = this.uploadPolicyResult$.pipe(
    map((result) => result.decision === 'ALLOW'),
    distinctUntilChanged()
  );

  readonly selectedFileName$ = this.selectedFile$.pipe(
    map((file) => file?.name ?? null),
    distinctUntilChanged()
  );

  readonly selectedFileSize$ = this.selectedFile$.pipe(
    map((file) => (file ? this.formatFileSize(file.size) : null)),
    distinctUntilChanged()
  );

  readonly selectedCaptionFileName$ = this.selectedCaptionFile$.pipe(
    map((file) => file?.name ?? null),
    distinctUntilChanged()
  );

  readonly viewItems$: Observable<ProfileVideoViewItem[]> = combineLatest([
    this.ownerUid$,
    this.isOwner$,
  ]).pipe(
    switchMap(([ownerUid, isOwner]) => {
      if (!ownerUid || !isOwner) {
        return of([] as ProfileVideoViewItem[]);
      }

      return combineLatest([
        this.videoLibrary.watchPrivateVideos$(ownerUid),
        this.videoPublication.watchOwnVideoPublications$(ownerUid).pipe(
          catchError(() => {
            this.errorNotification.showError(
              'Não foi possível carregar o estado de publicação dos vídeos.'
            );
            return of([] as IVideoPublicationConfig[]);
          })
        ),
      ]).pipe(
        map(([videos, publications]) => {
          const publicationByVideoId = new Map(
            publications.map((publication) => [
              publication.videoId,
              publication,
            ])
          );

          return videos.map((video) => ({
            video,
            publication: publicationByVideoId.get(video.id) ?? null,
          }));
        })
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.uploadSubscription?.unsubscribe();
      this.revokePreviewUrl();
      this.revokePosterUrl();
    });
  }

  onVideoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;

    if (!file) {
      return;
    }

    const format = resolveVideoUploadFormat(file);

    if (!format) {
      this.errorNotification.showError(
        `Formato não aceito. Use ${this.videoUploadFormatLabel}.`
      );
      input.value = '';
      return;
    }

    if (!Number.isFinite(file.size) || file.size <= 0) {
      this.errorNotification.showError('O arquivo selecionado está vazio.');
      input.value = '';
      return;
    }

    if (file.size > MAX_VIDEO_SIZE_BYTES) {
      this.errorNotification.showError('O vídeo excede o limite de 500 MB.');
      input.value = '';
      return;
    }

    this.uploadFailureSubject.next(null);
    this.revokePreviewUrl();
    this.revokePosterUrl();
    this.selectedPosterBlobSubject.next(null);
    this.selectedCaptionFileSubject.next(null);
    this.selectedFileSubject.next(file);
    this.previewUrlSubject.next(URL.createObjectURL(file));
    this.uploadPublicationForm.reset({
      title: this.defaultFileTitle(file.name),
      description: '',
      reactionsEnabled: true,
      commentsEnabled: true,
      ratingsEnabled: true,
      captionLanguage: DEFAULT_CAPTION_LANGUAGE,
      captionLabel: DEFAULT_CAPTION_LABEL,
      allParticipantsAdultsAndConsenting: false,
      rightsAndPermissionsConfirmed: false,
      prohibitedContentAcknowledged: false,
    });
    this.uploadPhaseSubject.next('READY');
    this.uploadProgressSubject.next(0);
    this.uploadStepSubject.next(
      format.browserPreviewLikely
        ? 'Revise a capa, as informações, a legenda opcional e as declarações antes de enviar.'
        : 'Formato aceito. A prévia pode não abrir neste navegador; o vídeo será convertido após o envio.'
    );
  }

  async onCaptionSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;

    if (!file) {
      return;
    }

    this.captionValidatingSubject.next(true);

    try {
      this.assertValidCaptionFile(file);
      const content = await file.text();
      this.assertValidWebVttContent(content);
      this.selectedCaptionFileSubject.next(
        file.type === 'text/vtt'
          ? file
          : new File([file], file.name, {
              type: 'text/vtt',
              lastModified: file.lastModified,
            })
      );
      this.errorNotification.showSuccess('Legenda WebVTT adicionada.');
    } catch (error) {
      input.value = '';
      this.selectedCaptionFileSubject.next(null);
      this.errorNotification.showError(
        error instanceof Error
          ? error.message
          : 'Não foi possível validar a legenda.'
      );
    } finally {
      this.captionValidatingSubject.next(false);
    }
  }

  removeCaption(fileInput?: HTMLInputElement): void {
    if (this.isUploadActive()) {
      return;
    }

    this.selectedCaptionFileSubject.next(null);

    if (fileInput) {
      fileInput.value = '';
    }
  }

  capturePoster(video: HTMLVideoElement): void {
    if (
      this.capturingPosterSubject.value ||
      this.uploadPhaseSubject.value !== 'READY' ||
      !this.selectedFileSubject.value
    ) {
      return;
    }

    this.capturingPosterSubject.next(true);

    this.metadataPreparation.captureCurrentFrame$(video).pipe(
      take(1),
      finalize(() => this.capturingPosterSubject.next(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (blob) => {
        this.revokePosterUrl();
        this.selectedPosterBlobSubject.next(blob);
        this.selectedPosterUrlSubject.next(URL.createObjectURL(blob));
        this.errorNotification.showSuccess('Capa do vídeo atualizada.');
      },
      error: (error: unknown) => {
        this.errorNotification.showWarning(
          error instanceof Error
            ? error.message
            : 'Não foi possível escolher este quadro como capa.'
        );
      },
    });
  }

  startUpload(): void {
    if (this.uploadSubscription || this.captionValidatingSubject.value) {
      return;
    }

    if (this.uploadPublicationForm.invalid) {
      this.uploadPublicationForm.markAllAsTouched();
      this.errorNotification.showWarning(
        'Revise o título, a legenda e confirme todas as declarações obrigatórias.'
      );
      return;
    }

    this.uploadFailureSubject.next(null);
    this.cancelRequestedByUser = false;
    let subscription: Subscription | null = null;

    const upload$ = combineLatest([
      this.uploadPolicyResult$,
      this.ownerUid$,
      this.selectedFile$,
      this.selectedPosterBlob$,
      this.selectedCaptionFile$,
      this.uploadPhase$,
    ]).pipe(
      take(1),
      switchMap(([
        policyResult,
        ownerUid,
        file,
        posterBlob,
        captionFile,
        phase,
      ]) => {
        if (phase !== 'READY' || !file) {
          this.errorNotification.showWarning(
            'Selecione um vídeo válido antes de enviar.'
          );
          return EMPTY;
        }

        if (policyResult.decision !== 'ALLOW') {
          this.errorNotification.showError(
            this.getPolicyDeniedMessage(policyResult.reason)
          );
          return EMPTY;
        }

        const publication = this.uploadPublicationSettings();
        const safetyAttestation = this.uploadSafetyAttestation();
        const caption = this.buildCaptionInput(captionFile);
        this.uploadPhaseSubject.next('PREPARING');
        this.uploadProgressSubject.next(0);
        this.uploadStepSubject.next(
          'Validando vídeo, capa, legenda e declarações.'
        );

        return this.videoUploadFlow.uploadPrivateVideo$({
          ownerUid,
          file,
          posterBlob,
          caption,
          publication,
          safetyAttestation,
        });
      }),
      finalize(() => {
        if (this.uploadSubscription === subscription) {
          this.uploadSubscription = null;
        }

        if (
          this.cancelRequestedByUser &&
          this.uploadPhaseSubject.value !== 'DONE'
        ) {
          this.uploadPhaseSubject.next('READY');
          this.uploadProgressSubject.next(0);
          this.uploadStepSubject.next(
            'Upload cancelado. A preparação foi mantida.'
          );
        }
      }),
      takeUntilDestroyed(this.destroyRef)
    );

    subscription = upload$.subscribe({
      next: (event) => this.handleUploadEvent(event),
      error: (error: unknown) => {
        const failure = this.describeUploadFailure(error);
        this.uploadFailureSubject.next(failure);
        this.uploadPhaseSubject.next('READY');
        this.uploadProgressSubject.next(0);
        this.uploadStepSubject.next('Envio interrompido.');
        this.errorNotification.showError(failure.message);
      },
    });

    this.uploadSubscription = subscription.closed ? null : subscription;
  }

  retryUpload(): void {
    if (
      this.uploadSubscription ||
      this.uploadPhaseSubject.value !== 'READY' ||
      !this.selectedFileSubject.value
    ) {
      return;
    }

    this.startUpload();
  }

  cancelUpload(): void {
    if (!this.canCancelUpload()) {
      return;
    }

    this.cancelRequestedByUser = true;
    this.uploadSubscription?.unsubscribe();
    this.errorNotification.showWarning('Upload cancelado.');
  }

  resetSelection(fileInput?: HTMLInputElement): void {
    if (this.isUploadActive()) {
      return;
    }

    this.uploadFailureSubject.next(null);
    this.revokePreviewUrl();
    this.revokePosterUrl();
    this.selectedFileSubject.next(null);
    this.selectedPosterBlobSubject.next(null);
    this.selectedCaptionFileSubject.next(null);
    this.previewUrlSubject.next(null);
    this.uploadPublicationForm.reset({
      title: '',
      description: '',
      reactionsEnabled: true,
      commentsEnabled: true,
      ratingsEnabled: true,
      captionLanguage: DEFAULT_CAPTION_LANGUAGE,
      captionLabel: DEFAULT_CAPTION_LABEL,
      allParticipantsAdultsAndConsenting: false,
      rightsAndPermissionsConfirmed: false,
      prohibitedContentAcknowledged: false,
    });
    this.uploadPhaseSubject.next('IDLE');
    this.uploadProgressSubject.next(0);
    this.uploadStepSubject.next('Selecione um vídeo para começar.');

    if (fileInput) {
      fileInput.value = '';
    }
  }

  startEditingPublication(item: ProfileVideoViewItem): void {
    if (this.isBusy(item.video.id)) {
      return;
    }

    this.editingVideoIdSubject.next(item.video.id);
    this.publicationSettingsForm.reset({
      title: item.publication?.title ?? this.defaultVideoTitle(item.video),
      description: item.publication?.description ?? '',
      reactionsEnabled: item.publication?.reactionsEnabled !== false,
      commentsEnabled: item.publication?.commentsEnabled !== false,
      ratingsEnabled: item.publication?.ratingsEnabled !== false,
    });
  }

  cancelEditingPublication(videoId: string): void {
    if (
      this.editingVideoIdSubject.value === videoId &&
      !this.isBusy(videoId)
    ) {
      this.editingVideoIdSubject.next(null);
      this.publicationSettingsForm.reset();
    }
  }

  savePublicationSettings(item: ProfileVideoViewItem): void {
    const videoId = item.video.id;

    if (
      this.editingVideoIdSubject.value !== videoId ||
      this.isBusy(videoId)
    ) {
      return;
    }

    if (this.publicationSettingsForm.invalid) {
      this.publicationSettingsForm.markAllAsTouched();
      this.errorNotification.showWarning(
        'Revise o título e a descrição antes de salvar.'
      );
      return;
    }

    const raw = this.publicationSettingsForm.getRawValue();
    const settings: IVideoPublicationSettingsInput = {
      title: raw.title.trim() || null,
      description: raw.description.trim() || null,
      reactionsEnabled: raw.reactionsEnabled,
      commentsEnabled: raw.commentsEnabled,
      ratingsEnabled: raw.ratingsEnabled,
    };

    this.setBusyAction(videoId, 'save');

    this.ownerUid$.pipe(
      take(1),
      switchMap((ownerUid) =>
        this.videoPublication.updateVideoPublicationSettings$(
          ownerUid,
          videoId,
          settings
        )
      ),
      finalize(() => this.clearBusyAction(videoId)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (result) => {
        this.editingVideoIdSubject.next(null);
        const message =
          result.isPublished && result.moderationStatus === 'PENDING_REVIEW'
            ? 'Alterações salvas e enviadas para moderação.'
            : 'Informações do vídeo salvas.';
        this.errorNotification.showSuccess(message);
      },
      error: () => {
        this.errorNotification.showError(
          'Não foi possível salvar as informações do vídeo.'
        );
      },
    });
  }

  publishVideo(item: ProfileVideoViewItem): void {
    if (this.editingVideoIdSubject.value === item.video.id) {
      this.errorNotification.showWarning(
        'Salve ou cancele a edição antes de publicar.'
      );
      return;
    }

    if (!this.canPublish(item) || this.isBusy(item.video.id)) {
      return;
    }

    this.setBusyAction(item.video.id, 'publish');

    this.ownerUid$.pipe(
      take(1),
      switchMap((ownerUid) =>
        this.videoPublication.publishVideo$(ownerUid, item.video.id)
      ),
      finalize(() => this.clearBusyAction(item.video.id)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (result) => {
        const message = result.moderationStatus === 'APPROVED'
          ? 'Vídeo publicado no perfil.'
          : 'Vídeo enviado para análise antes da publicação.';
        this.errorNotification.showSuccess(message);
      },
      error: () => {
        this.errorNotification.showError(
          'Não foi possível publicar este vídeo.'
        );
      },
    });
  }

  unpublishVideo(item: ProfileVideoViewItem): void {
    if (!item.publication?.isPublished || this.isBusy(item.video.id)) {
      return;
    }

    this.setBusyAction(item.video.id, 'unpublish');

    this.ownerUid$.pipe(
      take(1),
      switchMap((ownerUid) =>
        this.videoPublication.unpublishVideo$(ownerUid, item.video.id)
      ),
      finalize(() => this.clearBusyAction(item.video.id)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: () => {
        this.errorNotification.showSuccess('Vídeo removido da área pública.');
      },
      error: () => {
        this.errorNotification.showError(
          'Não foi possível remover a publicação do vídeo.'
        );
      },
    });
  }

  requestDelete(item: ProfileVideoViewItem): void {
    if (this.isBusy(item.video.id)) {
      return;
    }

    this.pendingDeleteVideoIdSubject.next(item.video.id);
  }

  cancelDelete(videoId: string): void {
    if (
      this.pendingDeleteVideoIdSubject.value === videoId &&
      !this.isBusy(videoId)
    ) {
      this.pendingDeleteVideoIdSubject.next(null);
    }
  }

  confirmDelete(item: ProfileVideoViewItem): void {
    const videoId = item.video.id;

    if (
      this.pendingDeleteVideoIdSubject.value !== videoId ||
      this.isBusy(videoId)
    ) {
      return;
    }

    this.pendingDeleteVideoIdSubject.next(null);
    this.setBusyAction(videoId, 'delete');

    this.ownerUid$.pipe(
      take(1),
      switchMap((ownerUid) =>
        this.videoPublication.deleteProfileVideo$(ownerUid, videoId)
      ),
      finalize(() => this.clearBusyAction(videoId)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (result) => {
        const message = result.cleanupPending
          ? 'Vídeo ocultado. A limpeza física será concluída automaticamente.'
          : 'Vídeo excluído com segurança.';
        this.errorNotification.showSuccess(message);
      },
      error: () => {
        this.errorNotification.showError('Não foi possível excluir este vídeo.');
      },
    });
  }

  canPublish(item: ProfileVideoViewItem): boolean {
    return (
      !item.publication?.isPublished &&
      item.publication?.publishWhenReady !== true &&
      item.video.status === 'ready' &&
      !!item.video.processedStoragePath &&
      this.isPublicPlaybackCompatible(item.video)
    );
  }

  isPublicPlaybackCompatible(video: IVideoItem): boolean {
    return PUBLIC_PLAYBACK_TYPES.has(
      String(video.processedMimeType ?? video.mimeType ?? '')
        .trim()
        .toLowerCase()
    );
  }

  isBusy(videoId: string): boolean {
    return this.busyActionsSubject.value.has(videoId);
  }

  canCancelUpload(): boolean {
    const phase = this.uploadPhaseSubject.value;

    return (
      !!this.uploadSubscription &&
      phase !== 'SAVING' &&
      phase !== 'DONE'
    );
  }

  isUploadActive(): boolean {
    return ['PREPARING', 'UPLOADING', 'SAVING'].includes(
      this.uploadPhaseSubject.value
    );
  }

  publicationLabel(item: ProfileVideoViewItem): string {
    if (item.video.status === 'failed') {
      return 'Falha';
    }

    if (!item.publication?.isPublished && item.publication?.publishWhenReady) {
      return item.video.status === 'ready' ? 'Publicando' : 'Preparando';
    }

    if (!item.publication?.isPublished) {
      return 'Publicação pendente';
    }

    if (item.publication.moderationStatus === 'APPROVED') {
      return 'Publicado';
    }

    if (item.publication.moderationStatus === 'PENDING_REVIEW') {
      return 'Em análise';
    }

    return 'Indisponível';
  }

  isPendingPublication(item: ProfileVideoViewItem): boolean {
    return item.publication?.publishWhenReady === true ||
      item.publication?.moderationStatus === 'PENDING_REVIEW';
  }

  processingLabel(video: IVideoItem): string {
    if (video.status === 'queued') {
      return 'Na fila';
    }

    if (video.status === 'processing') {
      return 'Processando';
    }

    if (video.status === 'failed') {
      return 'Falha no processamento';
    }

    if (video.status === 'ready') {
      return 'Pronto';
    }

    return 'Aguardando processamento';
  }

  displayVideoTitle(item: ProfileVideoViewItem): string {
    return item.publication?.title?.trim() ||
      this.defaultVideoTitle(item.video);
  }

  trackByVideoId(_index: number, item: ProfileVideoViewItem): string {
    return item.video.id;
  }

  formatFileSize(sizeBytes: number | null | undefined): string {
    const size = Number(sizeBytes ?? 0);

    if (!Number.isFinite(size) || size <= 0) {
      return 'Tamanho não informado';
    }

    if (size < 1024 * 1024) {
      return `${Math.round(size / 1024)} KB`;
    }

    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }

  formatDuration(durationMs: number | null | undefined): string {
    const totalSeconds = Math.max(
      0,
      Math.floor(Number(durationMs ?? 0) / 1000)
    );

    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
      return 'Duração não informada';
    }

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return [hours, minutes, seconds]
        .map((value, index) => index === 0
          ? String(value)
          : String(value).padStart(2, '0'))
        .join(':');
    }

    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  private uploadPublicationSettings():
    IVideoPublicationSettingsInput & { publishWhenReady: true } {
    const raw = this.uploadPublicationForm.getRawValue();

    return {
      title: raw.title.trim() || null,
      description: raw.description.trim() || null,
      reactionsEnabled: raw.reactionsEnabled,
      commentsEnabled: raw.commentsEnabled,
      ratingsEnabled: raw.ratingsEnabled,
      publishWhenReady: true,
    };
  }

  private uploadSafetyAttestation() {
    const raw = this.uploadPublicationForm.getRawValue();

    return buildVideoUploadSafetyAttestation({
      allParticipantsAdultsAndConsenting:
        raw.allParticipantsAdultsAndConsenting,
      rightsAndPermissionsConfirmed:
        raw.rightsAndPermissionsConfirmed,
      prohibitedContentAcknowledged:
        raw.prohibitedContentAcknowledged,
    });
  }

  private buildCaptionInput(file: File | null): IVideoUploadCaptionInput | null {
    if (!file) {
      return null;
    }

    const raw = this.uploadPublicationForm.getRawValue();
    const language = raw.captionLanguage.trim();
    const label = raw.captionLabel.replace(/\s+/g, ' ').trim();

    if (!language || this.uploadPublicationForm.controls.captionLanguage.invalid) {
      throw new Error('Informe um idioma válido para a legenda.');
    }

    if (!label || this.uploadPublicationForm.controls.captionLabel.invalid) {
      throw new Error('Informe um rótulo de até 40 caracteres para a legenda.');
    }

    return { file, language, label };
  }

  private assertValidCaptionFile(file: File): void {
    const fileName = String(file.name ?? '').trim().toLowerCase();

    if (!fileName.endsWith('.vtt')) {
      throw new Error('Selecione uma legenda no formato WebVTT (.vtt).');
    }

    if (!Number.isFinite(file.size) || file.size <= 0) {
      throw new Error('O arquivo de legenda está vazio.');
    }

    if (file.size > MAX_CAPTION_SIZE_BYTES) {
      throw new Error('A legenda excede o limite de 1 MB.');
    }
  }

  private assertValidWebVttContent(value: string): void {
    const normalized = String(value ?? '')
      .replace(/^\uFEFF/, '')
      .replace(/\r\n?/g, '\n');

    if (!/^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(normalized)) {
      throw new Error('O arquivo não possui um cabeçalho WebVTT válido.');
    }

    if (!WEBVTT_CUE_PATTERN.test(normalized)) {
      throw new Error('A legenda precisa conter pelo menos um trecho com tempo.');
    }
  }

  private defaultFileTitle(fileName: string): string {
    return String(fileName ?? '')
      .trim()
      .replace(/\.[A-Za-z0-9]{2,5}$/, '')
      .slice(0, 120) || 'Vídeo';
  }

  private defaultVideoTitle(video: IVideoItem): string {
    return this.defaultFileTitle(video.fileName ?? 'Vídeo');
  }

  private handleUploadEvent(event: IVideoUploadFlowEvent): void {
    if (event.type === 'progress') {
      this.uploadFailureSubject.next(null);
      this.uploadProgressSubject.next(event.progress);
      this.applyUploadProgressPhase(event.phase);
      return;
    }

    this.uploadFailureSubject.next(null);
    this.uploadPhaseSubject.next('DONE');
    this.uploadProgressSubject.next(100);
    this.uploadStepSubject.next(
      'Vídeo recebido. O processamento e a publicação continuarão automaticamente.'
    );
    this.revokePreviewUrl();
    this.revokePosterUrl();
    this.selectedFileSubject.next(null);
    this.selectedPosterBlobSubject.next(null);
    this.selectedCaptionFileSubject.next(null);
    this.previewUrlSubject.next(null);
    this.errorNotification.showSuccess(
      'Envio concluído. O vídeo seguirá para processamento, moderação e publicação.'
    );
  }

  private applyUploadProgressPhase(phase: VideoUploadProgressPhase): void {
    if (phase === 'preparing') {
      this.uploadPhaseSubject.next('PREPARING');
      this.uploadStepSubject.next('Lendo o arquivo e preparando o envio.');
      return;
    }

    if (phase === 'uploading-video') {
      this.uploadPhaseSubject.next('UPLOADING');
      this.uploadStepSubject.next('Enviando vídeo. Mantenha esta página aberta.');
      return;
    }

    if (phase === 'uploading-poster') {
      this.uploadPhaseSubject.next('UPLOADING');
      this.uploadStepSubject.next('Enviando capa.');
      return;
    }

    if (phase === 'uploading-caption') {
      this.uploadPhaseSubject.next('UPLOADING');
      this.uploadStepSubject.next('Enviando legenda acessível.');
      return;
    }

    this.uploadPhaseSubject.next('SAVING');
    this.uploadStepSubject.next(
      'Registrando publicação, legenda e declarações.'
    );
  }

  private describeUploadFailure(error: unknown): VideoUploadFailureFeedback {
    const code = this.uploadErrorCode(error);

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return {
        title: 'Sem conexão',
        message: 'A internet caiu durante o envio.',
        recovery: 'Reconecte-se e tente novamente. O arquivo e as informações foram mantidos.',
        retryable: true,
      };
    }

    if ([
      'storage/retry-limit-exceeded',
      'storage/unknown',
      'functions/unavailable',
      'functions/deadline-exceeded',
      'unavailable',
      'deadline-exceeded',
      'network-request-failed',
    ].includes(code)) {
      return {
        title: 'Conexão instável',
        message: 'O envio foi interrompido antes da conclusão.',
        recovery: 'Use uma rede mais estável ou aproxime-se do Wi-Fi e tente novamente. A preparação foi mantida.',
        retryable: true,
      };
    }

    if ([
      'storage/quota-exceeded',
      'functions/resource-exhausted',
      'resource-exhausted',
    ].includes(code)) {
      return {
        title: 'Limite temporário atingido',
        message: 'O serviço não conseguiu receber o vídeo agora.',
        recovery: 'Aguarde alguns minutos e tente novamente. Nenhuma cópia incompleta foi mantida.',
        retryable: true,
      };
    }

    if ([
      'functions/failed-precondition',
      'failed-precondition',
      'functions/invalid-argument',
      'invalid-argument',
    ].includes(code)) {
      return {
        title: 'Envio bloqueado',
        message: error instanceof Error && error.message.trim()
          ? error.message.trim()
          : 'Existe uma pendência que impede o envio deste vídeo.',
        recovery: 'Corrija a informação indicada e confirme novamente as declarações antes de um novo envio.',
        retryable: false,
      };
    }

    if ([
      'storage/unauthenticated',
      'storage/unauthorized',
      'functions/unauthenticated',
      'functions/permission-denied',
      'unauthenticated',
      'permission-denied',
    ].includes(code)) {
      return {
        title: 'Acesso expirado',
        message: 'Sua sessão ou permissão mudou durante o envio.',
        recovery: 'Entre novamente na conta e repita o envio.',
        retryable: false,
      };
    }

    const message = error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'Não foi possível concluir o envio do vídeo.';

    return {
      title: 'Falha no envio',
      message,
      recovery: 'Revise o arquivo e tente novamente. A preparação atual foi mantida.',
      retryable: true,
    };
  }

  private uploadErrorCode(error: unknown): string {
    if (typeof error !== 'object' || error === null || !('code' in error)) {
      return '';
    }

    return String((error as { code?: unknown }).code ?? '')
      .trim()
      .toLowerCase();
  }

  private setBusyAction(videoId: string, action: VideoBusyAction): void {
    const next = new Map(this.busyActionsSubject.value);
    next.set(videoId, action);
    this.busyActionsSubject.next(next);
  }

  private clearBusyAction(videoId: string): void {
    const next = new Map(this.busyActionsSubject.value);
    next.delete(videoId);
    this.busyActionsSubject.next(next);
  }

  private revokePreviewUrl(): void {
    const currentUrl = this.previewUrlSubject.value;

    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
      this.previewUrlSubject.next(null);
    }
  }

  private revokePosterUrl(): void {
    const currentUrl = this.selectedPosterUrlSubject.value;

    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
      this.selectedPosterUrlSubject.next(null);
    }
  }

  private getPolicyDeniedMessage(reason?: MediaPolicyDenyReason): string {
    if (reason === 'AGE_REVERIFICATION_REQUIRED') {
      return 'Conclua a revalidação de idade antes de enviar vídeos.';
    }

    if (reason === 'AGE_REVERIFICATION_RESTRICTED') {
      return 'Sua conta não pode enviar vídeos por restrição de idade.';
    }

    if (reason === 'EMAIL_UNVERIFIED') {
      return 'Confirme seu e-mail antes de enviar vídeos.';
    }

    if (reason === 'PROFILE_INCOMPLETE') {
      return 'Conclua seu perfil antes de enviar vídeos.';
    }

    if (reason === 'INTERACTION_BLOCKED' || reason === 'BLOCKED') {
      return 'Sua conta não pode enviar mídias neste momento.';
    }

    if (reason === 'NOT_OWNER') {
      return 'Você só pode enviar vídeos para o próprio perfil.';
    }

    return 'Não foi possível liberar o upload de vídeos agora.';
  }
}
