import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  Output,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import {
  BehaviorSubject,
  Observable,
  combineLatest,
  of,
} from 'rxjs';
import {
  auditTime,
  catchError,
  distinctUntilChanged,
  finalize,
  map,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs/operators';

import {
  DEFAULT_VIDEO_EDIT_RECIPE_INPUT,
  IVideoEditRecipeInput,
  TVideoEditAspectRatio,
  TVideoRotationDegrees,
} from 'src/app/core/interfaces/media/i-video-edit-recipe';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { IVideoEditorState } from 'src/app/core/services/media/video-editor-result.model';
import {
  IPreparedVideoMetadata,
  VideoMetadataPreparationService,
} from 'src/app/core/services/media/video-metadata-preparation.service';

export type IVideoSimpleEditorState = IVideoEditorState;

interface IVideoTrimTimelineState {
  readonly durationMs: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly editedDurationMs: number;
  readonly startPercent: number;
  readonly endPercent: number;
}

type TVideoTrimHandle = 'start' | 'end';
export type TVideoEditorTool = 'trim' | 'aspect' | 'audio' | 'cover';

const MIN_EDITED_DURATION_MS = 5_000;

@Component({
  selector: 'app-video-simple-editor-controls',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './video-simple-editor-controls.component.html',
  styleUrl: './video-simple-editor-controls.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VideoSimpleEditorControlsComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly metadataPreparation = inject(VideoMetadataPreparationService);
  private readonly errorNotification = inject(ErrorNotificationService);

  private readonly fileSubject = new BehaviorSubject<File | null>(null);
  private readonly metadataSubject =
    new BehaviorSubject<IPreparedVideoMetadata | null>(null);
  private readonly loadingSubject = new BehaviorSubject(false);
  private readonly capturingPosterSubject = new BehaviorSubject(false);
  private disabledValue = false;
  private activeTrimHandleValue: TVideoTrimHandle = 'end';

  readonly activeTool = signal<TVideoEditorTool>('trim');
  readonly previewTimeMs = signal(0);

  @Input()
  set file(value: File | null) {
    const next = value ?? null;
    if (this.fileSubject.value === next) {
      return;
    }

    this.posterChange.emit(null);
    this.resetForm();
    this.fileSubject.next(next);
  }

  @Input() previewUrl: string | null = null;

  @Input()
  set disabled(value: boolean) {
    const next = value === true;
    if (this.disabledValue === next) {
      return;
    }

    this.disabledValue = next;

    if (next) {
      this.form.disable({ emitEvent: false });
      return;
    }

    this.form.enable({ emitEvent: false });
  }

  get disabled(): boolean {
    return this.disabledValue;
  }

  get activeTrimHandle(): TVideoTrimHandle {
    return this.activeTrimHandleValue;
  }

  @Output() readonly posterChange = new EventEmitter<Blob | null>();
  @Output() readonly stateChange =
    new EventEmitter<IVideoSimpleEditorState>();

  readonly form = this.formBuilder.nonNullable.group({
    trimStartMs: [0],
    trimEndMs: [0],
    aspectRatio: ['ORIGINAL' as TVideoEditAspectRatio],
    rotationDegrees: [0 as TVideoRotationDegrees],
    muteAudio: [false],
  });

  readonly minimumEditedDurationMs = MIN_EDITED_DURATION_MS;
  readonly metadata$ = this.metadataSubject.asObservable();
  readonly loading$ = this.loadingSubject.asObservable();
  readonly capturingPoster$ = this.capturingPosterSubject.asObservable();

  private readonly formValue$ = this.form.valueChanges.pipe(
    startWith(this.form.getRawValue()),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly editorReady$: Observable<boolean> = this.metadata$.pipe(
    map((metadata) => !!(
      metadata?.playbackReady &&
      metadata.durationMs &&
      metadata.widthPixels &&
      metadata.heightPixels
    )),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly recipeError$: Observable<string | null> = combineLatest([
    this.metadata$,
    this.formValue$,
  ]).pipe(
    map(() => this.getValidationMessage()),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly trimTimeline$: Observable<IVideoTrimTimelineState> = combineLatest([
    this.metadata$,
    this.formValue$,
  ]).pipe(
    map(([metadata]) => this.buildTrimTimelineState(metadata?.durationMs ?? 0)),
    distinctUntilChanged((previous, current) =>
      previous.durationMs === current.durationMs &&
      previous.startMs === current.startMs &&
      previous.endMs === current.endMs
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly editedDurationLabel$: Observable<string> = this.trimTimeline$.pipe(
    map((timeline) => this.formatTime(timeline.editedDurationMs)),
    distinctUntilChanged()
  );

  readonly hasTrim$: Observable<boolean> = this.trimTimeline$.pipe(
    map((timeline) =>
      timeline.durationMs > 0 &&
      (timeline.startMs > 0 || timeline.endMs < timeline.durationMs)
    ),
    distinctUntilChanged()
  );

  readonly trimAnnouncement$: Observable<string> = this.trimTimeline$.pipe(
    auditTime(250),
    map((timeline) =>
      `Trecho selecionado de ${this.formatTime(timeline.startMs)} até ` +
      `${this.formatTime(timeline.endMs)}, com ` +
      `${this.formatTime(timeline.editedDurationMs)} de duração.`
    ),
    distinctUntilChanged()
  );

  readonly aspectOptions: ReadonlyArray<{
    value: TVideoEditAspectRatio;
    label: string;
    hint: string;
  }> = [
    { value: 'ORIGINAL', label: 'Original', hint: 'Sem recorte' },
    { value: 'VERTICAL_9_16', label: '9:16', hint: 'Stories e reels' },
    { value: 'PORTRAIT_4_5', label: '4:5', hint: 'Feed vertical' },
    { value: 'SQUARE_1_1', label: '1:1', hint: 'Quadrado' },
  ];

  constructor() {
    this.fileSubject.pipe(
      switchMap((file) => {
        this.metadataSubject.next(null);

        if (!file) {
          return of(null);
        }

        this.loadingSubject.next(true);
        return this.metadataPreparation.prepare$(file).pipe(
          catchError(() => of(null)),
          finalize(() => this.loadingSubject.next(false))
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((metadata) => {
      this.metadataSubject.next(metadata);
      const durationMs = metadata?.durationMs ?? 0;
      this.form.patchValue({
        trimStartMs: 0,
        trimEndMs: durationMs,
        aspectRatio: 'ORIGINAL',
        rotationDegrees: 0,
        muteAudio: false,
      });
    });

    this.form.controls.aspectRatio.valueChanges.pipe(
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => this.posterChange.emit(null));

    combineLatest([
      this.fileSubject,
      this.metadataSubject,
      this.loadingSubject,
      this.formValue$,
    ]).pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => this.emitEditorState());
  }

  buildRecipe(): IVideoEditRecipeInput {
    if (!this.fileSubject.value) {
      throw new Error('Selecione um vídeo antes de continuar.');
    }

    if (this.loadingSubject.value) {
      throw new Error('Aguarde a leitura do vídeo antes de continuar.');
    }

    const validationMessage = this.getValidationMessage();

    if (validationMessage) {
      throw new Error(validationMessage);
    }

    const metadata = this.metadataSubject.value;
    const raw = this.form.getRawValue();

    if (!metadata?.durationMs) {
      return DEFAULT_VIDEO_EDIT_RECIPE_INPUT;
    }

    const trimStartMs = Math.max(0, Math.trunc(raw.trimStartMs));
    const normalizedEndMs = Math.min(
      metadata.durationMs,
      Math.max(0, Math.trunc(raw.trimEndMs))
    );

    return {
      version: 1,
      trimStartMs,
      trimEndMs: normalizedEndMs >= metadata.durationMs
        ? null
        : normalizedEndMs,
      aspectRatio: raw.aspectRatio,
      rotationDegrees: raw.rotationDegrees,
      muteAudio: raw.muteAudio,
      orientation: 'AUTO',
      sourceWidthPixels: metadata.widthPixels,
      sourceHeightPixels: metadata.heightPixels,
    };
  }

  selectTool(tool: TVideoEditorTool): void {
    if (!this.disabled) {
      this.activeTool.set(tool);
    }
  }

  rotateClockwise(video: HTMLVideoElement): void {
    if (this.disabled) {
      return;
    }

    const current = this.form.controls.rotationDegrees.value;
    const next = ((current + 90) % 360) as TVideoRotationDegrees;
    this.form.controls.rotationDegrees.setValue(next);
    this.capturePoster(video, false);
  }

  rotationTransform(): string {
    return `rotate(${this.form.controls.rotationDegrees.value}deg)`;
  }

  onPreviewTimeUpdate(video: HTMLVideoElement): void {
    const currentMs = Number.isFinite(video.currentTime)
      ? Math.max(0, Math.trunc(video.currentTime * 1000))
      : 0;
    this.previewTimeMs.set(currentMs);
  }

  setActiveTrimHandle(handle: TVideoTrimHandle): void {
    this.activeTrimHandleValue = handle;
  }

  onTrimStartInput(video: HTMLVideoElement): void {
    this.setActiveTrimHandle('start');

    const durationMs = this.metadataSubject.value?.durationMs ?? 0;
    if (!durationMs) {
      return;
    }

    const requestedStartMs = this.normalizeMilliseconds(
      this.form.controls.trimStartMs.value,
      durationMs
    );
    const currentEndMs = this.normalizeMilliseconds(
      this.form.controls.trimEndMs.value,
      durationMs
    );
    const nextStartMs = Math.min(
      requestedStartMs,
      Math.max(0, currentEndMs - MIN_EDITED_DURATION_MS)
    );

    if (nextStartMs !== requestedStartMs) {
      this.form.controls.trimStartMs.setValue(nextStartMs);
    }

    this.seekPreview(video, nextStartMs);
  }

  onTrimEndInput(video: HTMLVideoElement): void {
    this.setActiveTrimHandle('end');

    const durationMs = this.metadataSubject.value?.durationMs ?? 0;
    if (!durationMs) {
      return;
    }

    const currentStartMs = this.normalizeMilliseconds(
      this.form.controls.trimStartMs.value,
      durationMs
    );
    const requestedEndMs = this.normalizeMilliseconds(
      this.form.controls.trimEndMs.value,
      durationMs
    );
    const nextEndMs = Math.max(
      requestedEndMs,
      Math.min(durationMs, currentStartMs + MIN_EDITED_DURATION_MS)
    );

    if (nextEndMs !== requestedEndMs) {
      this.form.controls.trimEndMs.setValue(nextEndMs);
    }

    this.seekPreview(video, nextEndMs);
  }

  resetTrim(video: HTMLVideoElement): void {
    const durationMs = this.metadataSubject.value?.durationMs ?? 0;
    if (!durationMs || this.disabled) {
      return;
    }

    this.activeTrimHandleValue = 'end';
    this.form.patchValue({
      trimStartMs: 0,
      trimEndMs: durationMs,
    });
    this.seekPreview(video, 0);
  }

  capturePoster(video: HTMLVideoElement, notify = true): void {
    if (
      this.disabled ||
      this.capturingPosterSubject.value ||
      !this.metadataSubject.value?.playbackReady
    ) {
      return;
    }

    this.capturingPosterSubject.next(true);

    this.metadataPreparation.captureCurrentFrame$(
      video,
      this.form.controls.aspectRatio.value,
      this.form.controls.rotationDegrees.value
    ).pipe(
      finalize(() => this.capturingPosterSubject.next(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (blob) => {
        this.posterChange.emit(blob);
        if (notify) {
          this.errorNotification.showSuccess('Capa do vídeo atualizada.');
        }
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

  formatTime(milliseconds: number | null | undefined): string {
    const totalSeconds = Math.max(
      0,
      Math.floor(Number(milliseconds ?? 0) / 1000)
    );
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  private buildTrimTimelineState(durationMs: number): IVideoTrimTimelineState {
    if (!durationMs) {
      return {
        durationMs: 0,
        startMs: 0,
        endMs: 0,
        editedDurationMs: 0,
        startPercent: 0,
        endPercent: 100,
      };
    }

    const raw = this.form.getRawValue();
    const startMs = this.normalizeMilliseconds(raw.trimStartMs, durationMs);
    const endMs = this.normalizeMilliseconds(raw.trimEndMs, durationMs);

    return {
      durationMs,
      startMs,
      endMs,
      editedDurationMs: Math.max(0, endMs - startMs),
      startPercent: (startMs / durationMs) * 100,
      endPercent: (endMs / durationMs) * 100,
    };
  }

  private normalizeMilliseconds(value: number, durationMs: number): number {
    return Math.min(durationMs, Math.max(0, Math.trunc(Number(value))));
  }

  private seekPreview(video: HTMLVideoElement, milliseconds: number): void {
    try {
      if (!video.paused) {
        video.pause();
      }
      video.currentTime = milliseconds / 1000;
      this.previewTimeMs.set(Math.max(0, Math.trunc(milliseconds)));
    } catch {
      // Alguns navegadores recusam seek antes de concluir a leitura dos metadados.
    }
  }

  private emitEditorState(): void {
    const loading = this.loadingSubject.value;

    if (!this.fileSubject.value || loading) {
      this.stateChange.emit({
        recipe: DEFAULT_VIDEO_EDIT_RECIPE_INPUT,
        valid: false,
        loading,
        error: null,
      });
      return;
    }

    try {
      this.stateChange.emit({
        recipe: this.buildRecipe(),
        valid: true,
        loading: false,
        error: null,
      });
    } catch (error) {
      this.stateChange.emit({
        recipe: DEFAULT_VIDEO_EDIT_RECIPE_INPUT,
        valid: false,
        loading: false,
        error: error instanceof Error
          ? error.message
          : 'Revise a edição antes de continuar.',
      });
    }
  }

  private getValidationMessage(): string | null {
    const metadata = this.metadataSubject.value;
    const raw = this.form.getRawValue();

    if (!this.fileSubject.value || this.loadingSubject.value) {
      return null;
    }

    if (
      !metadata?.playbackReady ||
      !metadata.durationMs ||
      !metadata.widthPixels ||
      !metadata.heightPixels
    ) {
      const hasRequestedEdit =
        raw.trimStartMs > 0 ||
        raw.aspectRatio !== 'ORIGINAL' ||
        raw.rotationDegrees !== 0 ||
        raw.muteAudio;

      return hasRequestedEdit
        ? 'Este navegador não conseguiu preparar a prévia para aplicar a edição.'
        : null;
    }

    const startMs = Math.max(0, Math.trunc(Number(raw.trimStartMs)));
    const endMs = Math.min(
      metadata.durationMs,
      Math.max(0, Math.trunc(Number(raw.trimEndMs)))
    );

    if (endMs <= startMs) {
      return 'O fim do corte precisa ser posterior ao início.';
    }

    if (endMs - startMs < MIN_EDITED_DURATION_MS) {
      return 'O vídeo editado precisa ter pelo menos 5 segundos.';
    }

    return null;
  }

  private resetForm(): void {
    this.activeTrimHandleValue = 'end';
    this.activeTool.set('trim');
    this.previewTimeMs.set(0);
    this.metadataSubject.next(null);
    this.form.reset({
      trimStartMs: 0,
      trimEndMs: 0,
      aspectRatio: 'ORIGINAL',
      rotationDegrees: 0,
      muteAudio: false,
    });
  }
}
