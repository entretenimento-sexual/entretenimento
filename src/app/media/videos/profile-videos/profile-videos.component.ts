// src/app/media/videos/profile-videos/profile-videos.component.ts
// -----------------------------------------------------------------------------
// Vídeos do usuário: publicar ou descartar, sem estado privado gerenciável.
// -----------------------------------------------------------------------------

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  BehaviorSubject,
  EMPTY,
  Observable,
  Subscription,
  combineLatest,
  of,
} from 'rxjs';
import {
  distinctUntilChanged,
  finalize,
  map,
  shareReplay,
  switchMap,
  take,
} from 'rxjs/operators';

import { IVideoItem } from 'src/app/core/interfaces/media/i-video-item';
import { IVideoPublicationSettingsInput } from 'src/app/core/interfaces/media/i-video-publication-config';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { MEDIA_VIDEO_MAX_BYTES } from 'src/app/core/services/media/media-format.policy';
import {
  IMediaPolicyResult,
  IMediaPolicyViewerSnapshot,
  MediaPolicyDenyReason,
  MediaPolicyService,
} from 'src/app/core/services/media/media-policy.service';
import { VideoEditorLauncherService } from 'src/app/core/services/media/video-editor-launcher.service';
import { IVideoEditorState } from 'src/app/core/services/media/video-editor-result.model';
import { VideoPublicationService } from 'src/app/core/services/media/video-publication.service';
import {
  VIDEO_UPLOAD_ACCEPT,
  VIDEO_UPLOAD_FORMAT_LABEL,
} from 'src/app/core/services/media/video-upload-format.policy';
import {
  IVideoUploadFlowEvent,
  VideoUploadFlowService,
  VideoUploadProgressPhase,
} from 'src/app/core/services/media/video-upload-flow.service';
import {
  ConfirmationDialogComponent,
  ConfirmationDialogData,
} from 'src/app/shared/components-globais/confirmation-dialog/confirmation-dialog.component';
import { ProfileVideoLibraryFacade } from '../state/profile-video-library.facade';
import type { IProfileVideoViewItem } from '../state/profile-video-library.models';
import { VideoSimpleEditorControlsComponent } from '../video-editor/video-editor-controls.entrypoint';

interface VideoUploadFailureFeedback {
  title: string;
  message: string;
  recovery: string;
  retryable: boolean;
}

type VideoBusyAction = 'delete' | 'save';
type VideoUploadUiPhase =
  | 'IDLE'
  | 'READY'
  | 'PREPARING'
  | 'UPLOADING'
  | 'SAVING'
  | 'DONE';

const DENY_UNKNOWN: IMediaPolicyResult = {
  decision: 'DENY',
  reason: 'UNKNOWN',
};

@Component({
  selector: 'app-profile-videos',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule,
    VideoSimpleEditorControlsComponent,
  ],
  templateUrl: './profile-videos.component.html',
  styleUrls: [
    './profile-videos.component.css',
    './profile-videos-settings.component.css',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileVideosComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly profileVideoLibrary = inject(ProfileVideoLibraryFacade);
  private readonly videoPublication = inject(VideoPublicationService);
  private readonly videoUploadFlow = inject(VideoUploadFlowService);
  private readonly videoEditor = inject(VideoEditorLauncherService);
  private readonly mediaPolicy = inject(MediaPolicyService);
  private readonly errorNotification = inject(ErrorNotificationService);
  private readonly dialog = inject(MatDialog);

  private readonly uploadDialogRef =
    viewChild<ElementRef<HTMLDialogElement>>('uploadDialog');
  private readonly publicationSettingsDialogRef =
    viewChild<ElementRef<HTMLDialogElement>>('publicationSettingsDialog');
  private readonly videoInputRef =
    viewChild<ElementRef<HTMLInputElement>>('videoInput');

  readonly videoUploadAccept = VIDEO_UPLOAD_ACCEPT;
  readonly videoUploadFormatLabel = VIDEO_UPLOAD_FORMAT_LABEL;
  readonly videoUploadMaxMegabytes = Number(
    (MEDIA_VIDEO_MAX_BYTES / (1024 * 1024)).toFixed(1)
  );

  private readonly busyActionsSubject = new BehaviorSubject<
    ReadonlyMap<string, VideoBusyAction>
  >(new Map());
  readonly busyActions$ = this.busyActionsSubject.asObservable();

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

  readonly selectedPosterBlob$ = this.videoEditor.posterBlobForSource$('profile-videos');
  readonly editorState$ = this.videoEditor.stateForSource$('profile-videos');

  private readonly uploadPhaseSubject = new BehaviorSubject<VideoUploadUiPhase>(
    'IDLE'
  );
  readonly uploadPhase$ = this.uploadPhaseSubject.asObservable();

  private readonly uploadProgressSubject = new BehaviorSubject<number>(0);
  readonly uploadProgress$ = this.uploadProgressSubject.asObservable();

  private readonly uploadStepSubject = new BehaviorSubject<string>('');
  readonly uploadStep$ = this.uploadStepSubject.asObservable();

  private readonly uploadFailureSubject =
    new BehaviorSubject<VideoUploadFailureFeedback | null>(null);
  readonly uploadFailure$ = this.uploadFailureSubject.asObservable();

  private uploadSubscription: Subscription | null = null;
  private editorLaunchSubscription: Subscription | null = null;
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

  readonly viewItems$: Observable<IProfileVideoViewItem[]> =
    this.profileVideoLibrary.viewItems$;

  constructor() {
    combineLatest([this.ownerUid$, this.isOwner$]).pipe(
      map(([ownerUid, isOwner]) => isOwner && ownerUid ? ownerUid : null),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((ownerUid) => this.profileVideoLibrary.watchOwner(ownerUid));

    this.destroyRef.onDestroy(() => {
      this.profileVideoLibrary.stop();
      this.editorLaunchSubscription?.unsubscribe();
      this.uploadSubscription?.unsubscribe();
      this.revokePreviewUrl();
      this.videoEditor.cancel('profile-videos');
    });
  }

  openUploadDialog(): void {
    const dialog = this.uploadDialogRef()?.nativeElement;
    if (!dialog || dialog.open) {
      return;
    }

    dialog.showModal();
  }

  closeUploadDialog(): void {
    if (this.isUploadActive()) {
      return;
    }

    const dialog = this.uploadDialogRef()?.nativeElement;
    if (dialog?.open) {
      dialog.close();
    }
  }

  onVideoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;

    if (!file) {
      return;
    }

    if (this.isUploadActive()) {
      input.value = '';
      return;
    }

    this.editorLaunchSubscription?.unsubscribe();
    let subscription: Subscription | null = null;

    const launch$ = this.videoEditor.launchFile$(file, {
      source: 'profile-videos',
    }).pipe(
      take(1),
      takeUntilDestroyed(this.destroyRef)
    );

    subscription = launch$.subscribe({
      next: () => {
        if (this.editorLaunchSubscription === subscription) {
          this.editorLaunchSubscription = null;
        }

        this.uploadFailureSubject.next(null);
        this.revokePreviewUrl();
        this.selectedFileSubject.next(file);
        this.previewUrlSubject.next(URL.createObjectURL(file));
        this.uploadPublicationForm.reset({
          title: this.defaultFileTitle(file.name),
          description: '',
          reactionsEnabled: true,
          commentsEnabled: true,
          ratingsEnabled: true,
        });
        this.uploadPhaseSubject.next('READY');
        this.uploadProgressSubject.next(0);
        this.uploadStepSubject.next('');
      },
      error: (error: unknown) => {
        if (this.editorLaunchSubscription === subscription) {
          this.editorLaunchSubscription = null;
        }

        input.value = '';
        this.errorNotification.showError(
          this.describeEditorLaunchFailure(error)
        );
      },
    });

    this.editorLaunchSubscription = subscription.closed ? null : subscription;
  }

  onEditorPosterChange(blob: Blob | null): void {
    if (this.isUploadActive()) return;
    this.videoEditor.updatePoster(blob, 'profile-videos');
  }

  onEditorStateChange(state: IVideoEditorState): void {
    if (this.isUploadActive()) return;
    this.videoEditor.updateState(state, 'profile-videos');
  }

  onUploadDialogCancel(event: Event): void {
    if (this.isUploadActive()) {
      event.preventDefault();
    }
  }

  startUpload(): void {
    if (this.uploadSubscription) {
      return;
    }

    if (this.uploadPublicationForm.invalid) {
      this.uploadPublicationForm.markAllAsTouched();
      this.errorNotification.showWarning(
        'Informe um título válido antes de enviar o vídeo.'
      );
      return;
    }

    this.uploadFailureSubject.next(null);
    this.cancelRequestedByUser = false;
    let subscription: Subscription | null = null;

    const upload$ = combineLatest([
      this.editorState$,
      this.uploadPolicyResult$,
      this.ownerUid$,
      this.uploadPhase$,
    ]).pipe(
      take(1),
      switchMap(([editorState, policyResult, ownerUid, phase]) => {
        if (!editorState?.valid) {
          this.errorNotification.showWarning(
            editorState?.loading
              ? 'Aguarde a leitura do vídeo antes de enviar.'
              : editorState?.error || 'Revise a edição antes de enviar o vídeo.'
          );
          return EMPTY;
        }

        if (phase !== 'READY' || !this.selectedFileSubject.value) {
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

        let editorResult;
        try {
          editorResult = this.videoEditor.complete('profile-videos');
        } catch (error) {
          this.errorNotification.showWarning(
            error instanceof Error && error.message.trim()
              ? error.message.trim()
              : 'Revise a edição antes de enviar o vídeo.'
          );
          return EMPTY;
        }

        const publication = this.uploadPublicationSettings();
        this.uploadPhaseSubject.next('PREPARING');
        this.uploadProgressSubject.next(0);
        this.uploadStepSubject.next('Preparando vídeo.');

        return this.videoUploadFlow.uploadPrivateVideo$({
          ownerUid,
          file: editorResult.file,
          posterBlob: editorResult.posterBlob,
          editRecipe: editorResult.recipe,
          publication,
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
          this.uploadStepSubject.next('');
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
        this.uploadStepSubject.next('');
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

    this.editorLaunchSubscription?.unsubscribe();
    this.editorLaunchSubscription = null;
    this.videoEditor.cancel('profile-videos');
    this.uploadFailureSubject.next(null);
    this.revokePreviewUrl();
    this.selectedFileSubject.next(null);
    this.previewUrlSubject.next(null);
    this.uploadPublicationForm.reset({
      title: '',
      description: '',
      reactionsEnabled: true,
      commentsEnabled: true,
      ratingsEnabled: true,
    });
    this.uploadPhaseSubject.next('IDLE');
    this.uploadProgressSubject.next(0);
    this.uploadStepSubject.next('');

    if (fileInput) {
      fileInput.value = '';
    }
  }

  startEditingPublication(item: IProfileVideoViewItem): void {
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

    const dialog = this.publicationSettingsDialogRef()?.nativeElement;
    if (!dialog) {
      this.editingVideoIdSubject.next(null);
      this.publicationSettingsForm.reset();
      this.errorNotification.showError(
        'Não foi possível abrir a edição do vídeo.'
      );
      return;
    }

    if (!dialog.open) {
      dialog.showModal();
    }
  }

  onPublicationSettingsDialogCancel(event: Event): void {
    const videoId = this.editingVideoIdSubject.value;
    if (!videoId) {
      return;
    }

    event.preventDefault();
    this.cancelEditingPublication(videoId);
  }

  cancelEditingPublication(videoId: string): void {
    if (
      this.editingVideoIdSubject.value === videoId &&
      !this.isBusy(videoId)
    ) {
      this.editingVideoIdSubject.next(null);
      this.publicationSettingsForm.reset();
      this.closePublicationSettingsDialog();
    }
  }

  savePublicationSettings(item: IProfileVideoViewItem): void {
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
      next: () => {
        this.editingVideoIdSubject.next(null);
        this.publicationSettingsForm.reset();
        this.closePublicationSettingsDialog();
        this.errorNotification.showSuccess('Informações salvas.');
      },
      error: () => {
        this.errorNotification.showError(
          'Não foi possível salvar as informações do vídeo.'
        );
      },
    });
  }

  requestDelete(item: IProfileVideoViewItem): void {
    const videoId = item.video.id;

    if (this.isBusy(videoId)) {
      return;
    }

    const dialogData: ConfirmationDialogData = {
      title: 'Excluir vídeo?',
      message: `O vídeo "${this.displayVideoTitle(item)}" será removido definitivamente da plataforma.`,
      confirmLabel: 'Excluir',
      cancelLabel: 'Cancelar',
      icon: 'delete_forever',
      tone: 'danger',
    };

    const ref = this.dialog.open<
      ConfirmationDialogComponent,
      ConfirmationDialogData,
      boolean
    >(ConfirmationDialogComponent, {
      panelClass: 'confirmation-dialog-panel',
      width: 'min(92vw, 420px)',
      maxWidth: '92vw',
      autoFocus: true,
      restoreFocus: true,
      data: dialogData,
    });

    ref.afterClosed().pipe(
      take(1),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((confirmed) => {
      if (confirmed) {
        this.confirmDelete(item);
      }
    });
  }

  confirmDelete(item: IProfileVideoViewItem): void {
    const videoId = item.video.id;

    if (this.isBusy(videoId)) {
      return;
    }

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
        this.errorNotification.showSuccess(
          result.cleanupPending
            ? 'Vídeo removido da plataforma. A limpeza física restante continuará automaticamente.'
            : 'Vídeo excluído da plataforma.'
        );
      },
      error: (error: unknown) => {
        this.errorNotification.showError(this.describeDeleteFailure(error));
      },
    });
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

  publicationLabel(item: IProfileVideoViewItem): string | null {
    const moderationStatus = item.publication?.moderationStatus;

    if (moderationStatus === 'FLAGGED' || moderationStatus === 'HIDDEN') {
      return 'Em revisão';
    }

    if (item.video.status !== 'ready') {
      return 'Preparando';
    }

    return null;
  }

  canOpenPublishedVideo(item: IProfileVideoViewItem): boolean {
    return item.video.status === 'ready' &&
      item.publication?.isPublished === true &&
      item.publication?.visibility === 'PUBLIC' &&
      item.publication?.moderationStatus === 'APPROVED';
  }

  openPublishedVideo(item: IProfileVideoViewItem): void {
    if (!this.canOpenPublishedVideo(item)) {
      return;
    }

    void this.router.navigate([
      '/media/video',
      item.video.ownerUid,
      item.video.id,
    ]);
  }

  mediaStateLabel(video: IVideoItem): string {
    if (video.status === 'queued' || video.status === 'processing') {
      return 'Vídeo em preparação para publicação.';
    }

    return 'Vídeo aguardando publicação.';
  }

  displayVideoTitle(item: IProfileVideoViewItem): string {
    return item.publication?.title?.trim() ||
      this.defaultVideoTitle(item.video);
  }

  trackByVideoId(_index: number, item: IProfileVideoViewItem): string {
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

  private uploadPublicationSettings(): IVideoPublicationSettingsInput {
    const raw = this.uploadPublicationForm.getRawValue();

    return {
      title: raw.title.trim() || null,
      description: raw.description.trim() || null,
      reactionsEnabled: raw.reactionsEnabled,
      commentsEnabled: raw.commentsEnabled,
      ratingsEnabled: raw.ratingsEnabled,
    };
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
    this.uploadStepSubject.next('');
    this.errorNotification.showSuccess('Vídeo enviado para publicação.');

    this.closeUploadDialog();
    this.resetSelection(this.videoInputRef()?.nativeElement);
  }

  private applyUploadProgressPhase(phase: VideoUploadProgressPhase): void {
    if (phase === 'preparing') {
      this.uploadPhaseSubject.next('PREPARING');
      this.uploadStepSubject.next('Preparando vídeo.');
      return;
    }

    if (phase === 'uploading-video') {
      this.uploadPhaseSubject.next('UPLOADING');
      this.uploadStepSubject.next('Enviando vídeo.');
      return;
    }

    if (phase === 'uploading-poster') {
      this.uploadPhaseSubject.next('UPLOADING');
      this.uploadStepSubject.next('Enviando capa.');
      return;
    }

    this.uploadPhaseSubject.next('SAVING');
    this.uploadStepSubject.next('Registrando vídeo.');
  }

  private describeEditorLaunchFailure(error: unknown): string {
    const message = error instanceof Error ? error.message.trim() : '';

    if (message === 'Usuário não autenticado para abrir o editor de vídeo.') {
      return 'Entre novamente na conta antes de editar e enviar vídeos.';
    }

    return message || 'Não foi possível abrir o editor de vídeo.';
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
        recovery: 'Use uma rede mais estável e tente novamente. A preparação local foi mantida.',
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
        recovery: 'Aguarde alguns minutos e tente novamente. Nenhuma cópia incompleta será mantida.',
        retryable: true,
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
      recovery: 'Revise o arquivo e tente novamente. A preparação local foi mantida.',
      retryable: true,
    };
  }

  private describeDeleteFailure(error: unknown): string {
    const code = this.uploadErrorCode(error);

    if (
      code === 'functions/unauthenticated' ||
      code === 'unauthenticated'
    ) {
      return 'Sua sessão expirou. Entre novamente antes de excluir o vídeo.';
    }

    if (
      code === 'functions/permission-denied' ||
      code === 'permission-denied'
    ) {
      return 'A exclusão foi bloqueada porque a conta atual não é proprietária deste vídeo.';
    }

    if (
      code === 'functions/unavailable' ||
      code === 'unavailable' ||
      code === 'network-request-failed'
    ) {
      return 'A exclusão não foi confirmada por falha de conexão. Tente novamente quando a rede estabilizar.';
    }

    return 'Não foi possível confirmar a exclusão total. O erro foi registrado para diagnóstico; tente novamente.';
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

  private closePublicationSettingsDialog(): void {
    const dialog = this.publicationSettingsDialogRef()?.nativeElement;
    if (dialog?.open) {
      dialog.close();
    }
  }

  private revokePreviewUrl(): void {
    const currentUrl = this.previewUrlSubject.value;

    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
      this.previewUrlSubject.next(null);
    }
  }

  private getPolicyDeniedMessage(reason?: MediaPolicyDenyReason): string {
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
