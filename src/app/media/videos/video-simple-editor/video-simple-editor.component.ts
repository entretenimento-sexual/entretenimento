import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
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

import {
  IVideoEditRecipeInput,
  TVideoEditAspectRatio,
} from 'src/app/core/interfaces/media/i-video-edit-recipe';
import { IVideoItem } from 'src/app/core/interfaces/media/i-video-item';
import { IVideoPublicationConfig } from 'src/app/core/interfaces/media/i-video-publication-config';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import {
  IMediaPolicyResult,
  IMediaPolicyViewerSnapshot,
  MediaPolicyService,
} from 'src/app/core/services/media/media-policy.service';
import {
  IPreparedVideoMetadata,
  VideoMetadataPreparationService,
} from 'src/app/core/services/media/video-metadata-preparation.service';
import { VideoEditedUploadFlowService } from 'src/app/core/services/media/video-edited-upload-flow.service';
import { VideoLibraryService } from 'src/app/core/services/media/video-library.service';
import { VideoPublicationService } from 'src/app/core/services/media/video-publication.service';
import { VideoReplacementUploadFlowService } from 'src/app/core/services/media/video-replacement-upload-flow.service';
import {
  VIDEO_UPLOAD_ACCEPT,
  VIDEO_UPLOAD_FORMAT_LABEL,
  resolveVideoUploadFormat,
} from 'src/app/core/services/media/video-upload-format.policy';
import {
  IVideoUploadFlowEvent,
  VideoUploadProgressPhase,
} from 'src/app/core/services/media/video-upload-flow.service';

interface EditorUploadFailure {
  title: string;
  message: string;
  recovery: string;
}

interface VideoReplacementTarget {
  video: IVideoItem;
  publication: IVideoPublicationConfig;
}

type EditorUploadPhase =
  | 'IDLE'
  | 'PREPARING_FILE'
  | 'READY'
  | 'UPLOADING'
  | 'SAVING'
  | 'DONE';

const MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024;
const MIN_EDITED_DURATION_SECONDS = 5;
const DENY_UNKNOWN: IMediaPolicyResult = {
  decision: 'DENY',
  reason: 'UNKNOWN',
};

@Component({
  selector: 'app-video-simple-editor',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './video-simple-editor.component.html',
  styleUrls: ['./video-simple-editor.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VideoSimpleEditorComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly mediaPolicy = inject(MediaPolicyService);
  private readonly metadataPreparation = inject(VideoMetadataPreparationService);
  private readonly uploadFlow = inject(VideoEditedUploadFlowService);
  private readonly replacementFlow = inject(VideoReplacementUploadFlowService);
  private readonly videoLibrary = inject(VideoLibraryService);
  private readonly videoPublication = inject(VideoPublicationService);
  private readonly errorNotification = inject(ErrorNotificationService);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);

  readonly videoUploadAccept = VIDEO_UPLOAD_ACCEPT;
  readonly videoUploadFormatLabel = VIDEO_UPLOAD_FORMAT_LABEL;
  readonly aspectOptions: ReadonlyArray<{
    value: TVideoEditAspectRatio;
    label: string;
    description: string;
  }> = [
    {
      value: 'ORIGINAL',
      label: 'Original',
      description: 'Mantém o enquadramento do arquivo.',
    },
    {
      value: 'VERTICAL_9_16',
      label: '9:16',
      description: 'Vertical para celular.',
    },
    {
      value: 'PORTRAIT_4_5',
      label: '4:5',
      description: 'Retrato com menos corte.',
    },
    {
      value: 'SQUARE_1_1',
      label: '1:1',
      description: 'Quadrado.',
    },
  ];

  readonly publicationForm = this.formBuilder.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(120)]],
    description: ['', [Validators.maxLength(1000)]],
    reactionsEnabled: [true],
    commentsEnabled: [true],
    ratingsEnabled: [true],
  });

  readonly editForm = this.formBuilder.nonNullable.group({
    trimStartSeconds: [0, [Validators.min(0)]],
    trimEndSeconds: [0, [Validators.min(MIN_EDITED_DURATION_SECONDS)]],
    aspectRatio: ['ORIGINAL' as TVideoEditAspectRatio],
    muteAudio: [false],
  });

  private readonly selectedFileSubject = new BehaviorSubject<File | null>(null);
  readonly selectedFile$ = this.selectedFileSubject.asObservable();

  private readonly previewUrlSubject = new BehaviorSubject<string | null>(null);
  readonly previewUrl$ = this.previewUrlSubject.asObservable();

  private readonly metadataSubject =
    new BehaviorSubject<IPreparedVideoMetadata | null>(null);
  readonly metadata$ = this.metadataSubject.asObservable();

  private readonly posterBlobSubject = new BehaviorSubject<Blob | null>(null);
  private readonly posterUrlSubject = new BehaviorSubject<string | null>(null);
  readonly posterUrl$ = this.posterUrlSubject.asObservable();

  private readonly phaseSubject = new BehaviorSubject<EditorUploadPhase>('IDLE');
  readonly phase$ = this.phaseSubject.asObservable();

  private readonly progressSubject = new BehaviorSubject(0);
  readonly progress$ = this.progressSubject.asObservable();

  private readonly stepSubject = new BehaviorSubject(
    'Selecione um vídeo para começar.'
  );
  readonly step$ = this.stepSubject.asObservable();

  private readonly failureSubject =
    new BehaviorSubject<EditorUploadFailure | null>(null);
  readonly failure$ = this.failureSubject.asObservable();

  private readonly capturingPosterSubject = new BehaviorSubject(false);
  readonly capturingPoster$ = this.capturingPosterSubject.asObservable();

  private uploadSubscription: Subscription | null = null;
  private uploadIsReplacement = false;

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
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly ownerUid$ = this.viewer$.pipe(
    map((viewer) => viewer?.uid ?? ''),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly replacementVideoId$ = this.route.queryParamMap.pipe(
    map((params) => String(params.get('videoId') ?? '').trim()),
    map((videoId) => /^[A-Za-z0-9_-]{1,128}$/.test(videoId) ? videoId : ''),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly replacementTarget$: Observable<VideoReplacementTarget | null> =
    combineLatest([this.ownerUid$, this.replacementVideoId$]).pipe(
      switchMap(([ownerUid, videoId]) => {
        if (!ownerUid || !videoId) return of(null);

        return combineLatest([
          this.videoLibrary.watchPrivateVideos$(ownerUid),
          this.videoPublication.watchOwnVideoPublications$(ownerUid),
        ]).pipe(
          map(([videos, publications]) => {
            const video = videos.find((item) => item.id === videoId) ?? null;
            const publication = publications.find(
              (item) => item.videoId === videoId
            ) ?? null;

            if (
              !video ||
              !publication ||
              video.status !== 'ready' ||
              !video.processedStoragePath ||
              publication.isPublished !== true ||
              publication.moderationStatus !== 'APPROVED'
            ) {
              return null;
            }

            return { video, publication };
          })
        );
      }),
      catchError((error: unknown) => {
        this.reportError(error, { op: 'replacementTarget$' });
        this.errorNotification.showError(
          'Não foi possível carregar o vídeo que será substituído.'
        );
        return of(null);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly isReplacement$ = this.replacementTarget$.pipe(
    map((target) => !!target),
    distinctUntilChanged()
  );

  readonly uploadPolicyResult$ = combineLatest([
    this.viewer$,
    this.ownerUid$,
  ]).pipe(
    switchMap(([viewer, ownerUid]) =>
      ownerUid
        ? this.mediaPolicy.canUploadProfileVideosForViewer$(viewer, ownerUid)
        : of(DENY_UNKNOWN)
    ),
    catchError((error: unknown) => {
      this.reportError(error, { op: 'uploadPolicyResult$' });
      return of(DENY_UNKNOWN);
    }),
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
    map((file) => file ? this.formatFileSize(file.size) : null),
    distinctUntilChanged()
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

    if (!file) return;

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

    this.resetSelectionState();
    this.selectedFileSubject.next(file);
    this.previewUrlSubject.next(URL.createObjectURL(file));
    this.phaseSubject.next('PREPARING_FILE');
    this.stepSubject.next('Lendo duração, dimensões e quadro inicial.');
    this.publicationForm.reset({
      title: this.defaultFileTitle(file.name),
      description: '',
      reactionsEnabled: true,
      commentsEnabled: true,
      ratingsEnabled: true,
    });
    this.editForm.reset({
      trimStartSeconds: 0,
      trimEndSeconds: 0,
      aspectRatio: 'ORIGINAL',
      muteAudio: false,
    });

    this.replacementTarget$
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe((target) => {
        if (!target) return;

        this.publicationForm.patchValue({
          title: target.publication.title ??
            this.defaultFileTitle(target.video.fileName ?? file.name),
          description: target.publication.description ?? '',
          reactionsEnabled: target.publication.reactionsEnabled !== false,
          commentsEnabled: target.publication.commentsEnabled !== false,
          ratingsEnabled: target.publication.ratingsEnabled !== false,
        });
      });

    this.metadataPreparation.prepare$(file).pipe(
      take(1),
      finalize(() => {
        if (this.phaseSubject.value === 'PREPARING_FILE') {
          this.phaseSubject.next('READY');
        }
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (metadata) => {
        this.metadataSubject.next(metadata);
        const durationSeconds = metadata.durationMs
          ? metadata.durationMs / 1000
          : 0;
        this.editForm.patchValue({
          trimStartSeconds: 0,
          trimEndSeconds: Number(durationSeconds.toFixed(1)),
        });

        if (metadata.posterBlob) this.setPoster(metadata.posterBlob);

        this.stepSubject.next(
          metadata.playbackReady
            ? 'Revise o corte, o enquadramento e a capa.'
            : 'O arquivo pode ser enviado, mas este navegador não conseguiu habilitar toda a edição local.'
        );
      },
      error: (error: unknown) => {
        this.metadataSubject.next(null);
        this.stepSubject.next(
          'Não foi possível preparar a prévia. O envio sem corte continua disponível.'
        );
        this.reportError(error, { op: 'prepareSelectedVideo' });
      },
    });
  }

  capturePoster(video: HTMLVideoElement): void {
    if (this.capturingPosterSubject.value || !this.selectedFileSubject.value) {
      return;
    }

    this.capturingPosterSubject.next(true);
    const aspectRatio = this.editForm.controls.aspectRatio.value;

    this.metadataPreparation.captureCurrentFrame$(video, aspectRatio).pipe(
      take(1),
      finalize(() => this.capturingPosterSubject.next(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (blob) => {
        this.setPoster(blob);
        this.errorNotification.showSuccess(
          'Capa atualizada com o enquadramento selecionado.'
        );
      },
      error: (error: unknown) => {
        this.errorNotification.showWarning(
          error instanceof Error
            ? error.message
            : 'Não foi possível usar este quadro como capa.'
        );
      },
    });
  }

  useCurrentTimeAsStart(video: HTMLVideoElement): void {
    const metadata = this.metadataSubject.value;
    const durationSeconds = (metadata?.durationMs ?? 0) / 1000;
    const current = this.safeSeconds(video.currentTime);
    const currentEnd = this.editForm.controls.trimEndSeconds.value ||
      durationSeconds;
    const maxStart = Math.max(0, currentEnd - MIN_EDITED_DURATION_SECONDS);

    this.editForm.controls.trimStartSeconds.setValue(
      Number(Math.min(current, maxStart).toFixed(1))
    );
  }

  useCurrentTimeAsEnd(video: HTMLVideoElement): void {
    const metadata = this.metadataSubject.value;
    const durationSeconds = (metadata?.durationMs ?? 0) / 1000;
    const current = this.safeSeconds(video.currentTime);
    const currentStart = this.editForm.controls.trimStartSeconds.value;
    const minEnd = currentStart + MIN_EDITED_DURATION_SECONDS;

    this.editForm.controls.trimEndSeconds.setValue(
      Number(Math.min(durationSeconds, Math.max(current, minEnd)).toFixed(1))
    );
  }

  seekToStart(video: HTMLVideoElement): void {
    video.currentTime = this.editForm.controls.trimStartSeconds.value;
  }

  startUpload(publishWhenReady = true): void {
    void publishWhenReady;

    if (this.uploadSubscription || this.publicationForm.invalid) {
      this.publicationForm.markAllAsTouched();
      return;
    }

    const validationMessage = this.validateEditForm();

    if (validationMessage) {
      this.errorNotification.showWarning(validationMessage);
      return;
    }

    this.failureSubject.next(null);

    const source$ = combineLatest([
      this.uploadPolicyResult$,
      this.ownerUid$,
      this.selectedFile$,
      this.metadata$,
      this.replacementTarget$,
    ]).pipe(
      take(1),
      switchMap(([policy, ownerUid, file, metadata, replacementTarget]) => {
        if (policy.decision !== 'ALLOW') {
          this.errorNotification.showError(
            'Confirme o e-mail, conclua o perfil e mantenha a conta regular para enviar vídeos.'
          );
          return EMPTY;
        }

        if (!ownerUid || !file) {
          this.errorNotification.showWarning('Selecione um vídeo válido.');
          return EMPTY;
        }

        const editRecipe = this.buildEditRecipe(metadata);
        const publicationRaw = this.publicationForm.getRawValue();
        const publication = {
          title: publicationRaw.title.trim() || null,
          description: publicationRaw.description.trim() || null,
          reactionsEnabled: publicationRaw.reactionsEnabled,
          commentsEnabled: publicationRaw.commentsEnabled,
          ratingsEnabled: publicationRaw.ratingsEnabled,
        };
        this.uploadIsReplacement = !!replacementTarget;
        this.phaseSubject.next('UPLOADING');
        this.progressSubject.next(0);
        this.stepSubject.next(
          replacementTarget
            ? 'Preparando a nova versão do vídeo.'
            : 'Preparando o upload editado.'
        );

        if (replacementTarget) {
          const currentStoragePath = String(
            replacementTarget.video.path ?? replacementTarget.video.url ?? ''
          ).trim();

          if (!currentStoragePath) {
            this.errorNotification.showError(
              'A versão atual do vídeo não está disponível para substituição.'
            );
            return EMPTY;
          }

          return this.replacementFlow.replaceEditedVideo$({
            ownerUid,
            videoId: replacementTarget.video.id,
            currentStoragePath,
            file,
            posterBlob: this.posterBlobSubject.value,
            durationMs: metadata?.durationMs ?? null,
            publication,
            editRecipe,
          });
        }

        return this.uploadFlow.uploadEditedVideo$({
          ownerUid,
          file,
          posterBlob: this.posterBlobSubject.value,
          publication: {
            ...publication,
            publishWhenReady: true,
          },
          editRecipe,
        });
      }),
      finalize(() => {
        this.uploadSubscription = null;
      }),
      takeUntilDestroyed(this.destroyRef)
    );

    const subscription = source$.subscribe({
      next: (event) => this.handleUploadEvent(event),
      error: (error: unknown) => {
        const failure = this.describeFailure(error);
        this.failureSubject.next(failure);
        this.phaseSubject.next('READY');
        this.progressSubject.next(0);
        this.stepSubject.next('Envio interrompido.');
        this.errorNotification.showError(failure.message);
      },
    });

    this.uploadSubscription = subscription.closed ? null : subscription;
  }

  cancelUpload(): void {
    if (!this.uploadSubscription || this.phaseSubject.value === 'SAVING') {
      return;
    }

    this.uploadSubscription.unsubscribe();
    this.uploadSubscription = null;
    this.phaseSubject.next('READY');
    this.progressSubject.next(0);
    this.stepSubject.next('Upload cancelado. A edição foi mantida.');
    this.errorNotification.showWarning('Upload cancelado.');
  }

  reset(fileInput?: HTMLInputElement): void {
    if (this.uploadSubscription) return;

    this.resetSelectionState();
    this.selectedFileSubject.next(null);
    this.phaseSubject.next('IDLE');
    this.progressSubject.next(0);
    this.stepSubject.next('Selecione um vídeo para começar.');
    this.publicationForm.reset({
      title: '',
      description: '',
      reactionsEnabled: true,
      commentsEnabled: true,
      ratingsEnabled: true,
    });
    this.editForm.reset({
      trimStartSeconds: 0,
      trimEndSeconds: 0,
      aspectRatio: 'ORIGINAL',
      muteAudio: false,
    });

    if (fileInput) fileInput.value = '';
  }

  isEditingAvailable(metadata: IPreparedVideoMetadata | null): boolean {
    return !!metadata?.durationMs &&
      !!metadata.widthPixels &&
      !!metadata.heightPixels &&
      metadata.playbackReady;
  }

  isUploadActive(phase: EditorUploadPhase | null): boolean {
    return phase === 'UPLOADING' || phase === 'SAVING';
  }

  formatDuration(milliseconds: number | null | undefined): string {
    const totalSeconds = Math.max(
      0,
      Math.floor(Number(milliseconds ?? 0) / 1000)
    );
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  private buildEditRecipe(
    metadata: IPreparedVideoMetadata | null
  ): IVideoEditRecipeInput {
    const raw = this.editForm.getRawValue();
    const durationMs = metadata?.durationMs ?? null;
    const startMs = Math.max(0, Math.round(raw.trimStartSeconds * 1000));
    const requestedEndMs = Math.max(0, Math.round(raw.trimEndSeconds * 1000));
    const trimEndMs =
      durationMs && requestedEndMs < durationMs - 50
        ? requestedEndMs
        : null;
    const hasDimensions = !!metadata?.widthPixels && !!metadata.heightPixels;

    return {
      version: 1,
      trimStartMs: durationMs ? startMs : 0,
      trimEndMs: durationMs ? trimEndMs : null,
      aspectRatio: hasDimensions ? raw.aspectRatio : 'ORIGINAL',
      muteAudio: raw.muteAudio,
      orientation: 'AUTO',
      sourceWidthPixels: metadata?.widthPixels ?? null,
      sourceHeightPixels: metadata?.heightPixels ?? null,
    };
  }

  private validateEditForm(): string | null {
    const metadata = this.metadataSubject.value;
    const raw = this.editForm.getRawValue();

    if (!metadata?.durationMs) {
      if (raw.aspectRatio !== 'ORIGINAL') {
        return 'O enquadramento só pode ser alterado quando a prévia estiver disponível.';
      }
      return null;
    }

    const durationSeconds = metadata.durationMs / 1000;

    if (
      raw.trimStartSeconds < 0 ||
      raw.trimEndSeconds > durationSeconds ||
      raw.trimEndSeconds <= raw.trimStartSeconds
    ) {
      return 'Revise o início e o fim do corte.';
    }

    if (
      raw.trimEndSeconds - raw.trimStartSeconds <
      MIN_EDITED_DURATION_SECONDS
    ) {
      return 'O vídeo editado precisa ter pelo menos 5 segundos.';
    }

    return null;
  }

  private handleUploadEvent(event: IVideoUploadFlowEvent): void {
    if (event.type === 'progress') {
      this.progressSubject.next(event.progress);
      this.applyProgressPhase(event.phase);
      return;
    }

    this.phaseSubject.next('DONE');
    this.progressSubject.next(100);
    this.stepSubject.next(
      this.uploadIsReplacement
        ? 'Nova versão enviada. O vídeo público atual permanece visível durante o processamento.'
        : 'Vídeo enviado e encaminhado para processamento.'
    );
    this.errorNotification.showSuccess(
      this.uploadIsReplacement
        ? 'Nova versão enviada. A troca ocorrerá automaticamente quando estiver pronta.'
        : 'Vídeo enviado. A edição será aplicada no processamento.'
    );
  }

  private applyProgressPhase(phase: VideoUploadProgressPhase): void {
    if (phase === 'saving') {
      this.phaseSubject.next('SAVING');
      this.stepSubject.next('Registrando edição e preparando a fila.');
      return;
    }

    this.phaseSubject.next('UPLOADING');
    this.stepSubject.next(
      phase === 'uploading-poster'
        ? 'Enviando a capa.'
        : phase === 'uploading-video'
          ? 'Enviando o vídeo.'
          : 'Validando arquivo e edição.'
    );
  }

  private describeFailure(error: unknown): EditorUploadFailure {
    const message = error instanceof Error
      ? error.message
      : 'Não foi possível enviar o vídeo editado.';

    return {
      title: 'Envio não concluído',
      message,
      recovery:
        'Revise a conexão, o corte e o formato do arquivo antes de tentar novamente.',
    };
  }

  private setPoster(blob: Blob): void {
    this.revokePosterUrl();
    this.posterBlobSubject.next(blob);
    this.posterUrlSubject.next(URL.createObjectURL(blob));
  }

  private resetSelectionState(): void {
    this.failureSubject.next(null);
    this.metadataSubject.next(null);
    this.posterBlobSubject.next(null);
    this.revokePreviewUrl();
    this.revokePosterUrl();
    this.previewUrlSubject.next(null);
    this.posterUrlSubject.next(null);
  }

  private revokePreviewUrl(): void {
    const url = this.previewUrlSubject.value;
    if (url) URL.revokeObjectURL(url);
  }

  private revokePosterUrl(): void {
    const url = this.posterUrlSubject.value;
    if (url) URL.revokeObjectURL(url);
  }

  private safeSeconds(value: number): number {
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }

  private defaultFileTitle(fileName: string): string {
    return String(fileName ?? '')
      .trim()
      .replace(/\.[A-Za-z0-9]{2,5}$/, '')
      .slice(0, 120) || 'Vídeo';
  }

  private formatFileSize(sizeBytes: number): string {
    return sizeBytes < 1024 * 1024
      ? `${Math.round(sizeBytes / 1024)} KB`
      : `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
  }

  private reportError(
    error: unknown,
    context: Record<string, unknown>
  ): void {
    try {
      const normalized = error instanceof Error
        ? error
        : new Error('Falha no editor simples de vídeo.');
      (normalized as any).context = {
        scope: 'VideoSimpleEditorComponent',
        ...context,
      };
      (normalized as any).skipUserNotification = true;
      this.globalErrorHandler.handleError(normalized);
    } catch {
      // noop
    }
  }
}
