// src/app/media/videos/profile-videos/profile-videos.component.ts
// -----------------------------------------------------------------------------
// Biblioteca privada, upload recuperável e publicação controlada de vídeos.
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
import { VideoPublicationService } from 'src/app/core/services/media/video-publication.service';
import {
  IVideoUploadFlowEvent,
  VideoUploadFlowService,
  VideoUploadProgressPhase,
} from 'src/app/core/services/media/video-upload-flow.service';

interface ProfileVideoViewItem {
  video: IVideoItem;
  publication: IVideoPublicationConfig | null;
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
const ALLOWED_VIDEO_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);
const PUBLIC_PLAYBACK_TYPES = new Set(['video/mp4', 'video/webm']);
const DENY_UNKNOWN: IMediaPolicyResult = {
  decision: 'DENY',
  reason: 'UNKNOWN',
};

@Component({
  selector: 'app-profile-videos',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './profile-videos.component.html',
  styleUrls: ['./profile-videos.component.css'],
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
  private readonly mediaPolicy = inject(MediaPolicyService);
  private readonly errorNotification = inject(ErrorNotificationService);

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

  readonly selectedFileSize$ = this.selectedFile$.pipe(
    map((file) => (file ? this.formatFileSize(file.size) : null)),
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
    });
  }

  onVideoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;

    if (!file) {
      return;
    }

    const mimeType = String(file.type ?? '').toLowerCase();

    if (!ALLOWED_VIDEO_TYPES.has(mimeType)) {
      this.errorNotification.showError('Envie um vídeo MP4, WebM ou MOV.');
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

    this.revokePreviewUrl();
    this.selectedFileSubject.next(file);
    this.previewUrlSubject.next(URL.createObjectURL(file));
    this.uploadPhaseSubject.next('READY');
    this.uploadProgressSubject.next(0);
    this.uploadStepSubject.next(
      mimeType === 'video/quicktime'
        ? 'MOV será enviado e convertido pelo backend antes da publicação.'
        : 'Vídeo pronto para envio e processamento seguro.'
    );
  }

  startUpload(): void {
    if (this.uploadSubscription) {
      return;
    }

    this.cancelRequestedByUser = false;
    let subscription: Subscription | null = null;

    const upload$ = combineLatest([
      this.uploadPolicyResult$,
      this.ownerUid$,
      this.selectedFile$,
      this.uploadPhase$,
    ]).pipe(
      take(1),
      switchMap(([policyResult, ownerUid, file, phase]) => {
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

        this.uploadPhaseSubject.next('PREPARING');
        this.uploadProgressSubject.next(0);
        this.uploadStepSubject.next('Preparando duração e imagem de capa.');

        return this.videoUploadFlow.uploadPrivateVideo$({
          ownerUid,
          file,
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
            'Upload cancelado. O arquivo pode ser reenviado.'
          );
        }
      }),
      takeUntilDestroyed(this.destroyRef)
    );

    subscription = upload$.subscribe({
      next: (event) => this.handleUploadEvent(event),
      error: () => {
        this.uploadPhaseSubject.next('READY');
        this.uploadProgressSubject.next(0);
        this.uploadStepSubject.next(
          'Falha no envio. Revise o arquivo e tente novamente.'
        );
        this.errorNotification.showError(
          'Não foi possível enviar o vídeo. Nenhum arquivo incompleto foi mantido.'
        );
      },
    });

    this.uploadSubscription = subscription.closed ? null : subscription;
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

    this.revokePreviewUrl();
    this.selectedFileSubject.next(null);
    this.previewUrlSubject.next(null);
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
    if (!item.publication?.isPublished) {
      return 'Privado';
    }

    if (item.publication.moderationStatus === 'APPROVED') {
      return 'Publicado';
    }

    if (item.publication.moderationStatus === 'PENDING_REVIEW') {
      return 'Em análise';
    }

    return 'Publicação indisponível';
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

  private defaultVideoTitle(video: IVideoItem): string {
    const fileName = String(video.fileName ?? '').trim();

    if (!fileName) {
      return 'Vídeo';
    }

    return fileName.replace(/\.[A-Za-z0-9]{2,5}$/, '').slice(0, 120) ||
      'Vídeo';
  }

  private handleUploadEvent(event: IVideoUploadFlowEvent): void {
    if (event.type === 'progress') {
      this.uploadProgressSubject.next(event.progress);
      this.applyUploadProgressPhase(event.phase);
      return;
    }

    this.uploadPhaseSubject.next('DONE');
    this.uploadProgressSubject.next(100);
    this.uploadStepSubject.next(
      event.result.status === 'queued'
        ? 'Vídeo salvo e adicionado à fila de processamento.'
        : event.result.status === 'ready'
          ? 'Vídeo salvo e pronto para publicação.'
          : 'Vídeo salvo e aguardando processamento.'
    );
    this.revokePreviewUrl();
    this.selectedFileSubject.next(null);
    this.previewUrlSubject.next(null);
    this.errorNotification.showSuccess(
      'Vídeo recebido. O processamento continuará em segundo plano.'
    );
  }

  private applyUploadProgressPhase(phase: VideoUploadProgressPhase): void {
    if (phase === 'preparing') {
      this.uploadPhaseSubject.next('PREPARING');
      this.uploadStepSubject.next(
        'Lendo duração e preparando imagem de capa.'
      );
      return;
    }

    if (phase === 'uploading-video') {
      this.uploadPhaseSubject.next('UPLOADING');
      this.uploadStepSubject.next(
        'Enviando o arquivo privado com segurança.'
      );
      return;
    }

    if (phase === 'uploading-poster') {
      this.uploadPhaseSubject.next('UPLOADING');
      this.uploadStepSubject.next('Enviando a imagem de capa do vídeo.');
      return;
    }

    this.uploadPhaseSubject.next('SAVING');
    this.uploadStepSubject.next('Registrando o vídeo e preparando a fila.');
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
