import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  Output,
  inject,
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
} from 'src/app/core/interfaces/media/i-video-edit-recipe';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import {
  IPreparedVideoMetadata,
  VideoMetadataPreparationService,
} from 'src/app/core/services/media/video-metadata-preparation.service';

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
    this.disabledValue = value === true;
  }

  get disabled(): boolean {
    return this.disabledValue;
  }

  @Output() readonly posterChange = new EventEmitter<Blob | null>();

  readonly form = this.formBuilder.nonNullable.group({
    trimStartMs: [0],
    trimEndMs: [0],
    aspectRatio: ['ORIGINAL' as TVideoEditAspectRatio],
    muteAudio: [false],
  });

  readonly metadata$ = this.metadataSubject.asObservable();
  readonly loading$ = this.loadingSubject.asObservable();
  readonly capturingPoster$ = this.capturingPosterSubject.asObservable();

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
    this.form.valueChanges.pipe(startWith(this.form.getRawValue())),
  ]).pipe(
    map(() => this.getValidationMessage()),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly editedDurationLabel$: Observable<string> = combineLatest([
    this.metadata$,
    this.form.valueChanges.pipe(startWith(this.form.getRawValue())),
  ]).pipe(
    map(([metadata]) => {
      const durationMs = metadata?.durationMs ?? 0;
      const raw = this.form.getRawValue();
      const endMs = Math.min(durationMs, Number(raw.trimEndMs ?? durationMs));
      const editedMs = Math.max(0, endMs - Number(raw.trimStartMs ?? 0));
      return this.formatTime(editedMs);
    }),
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
        muteAudio: false,
      });
    });

    this.form.controls.aspectRatio.valueChanges.pipe(
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => this.posterChange.emit(null));
  }

  buildRecipe(): IVideoEditRecipeInput {
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
      muteAudio: raw.muteAudio,
      orientation: 'AUTO',
      sourceWidthPixels: metadata.widthPixels,
      sourceHeightPixels: metadata.heightPixels,
    };
  }

  capturePoster(video: HTMLVideoElement): void {
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
      this.form.controls.aspectRatio.value
    ).pipe(
      finalize(() => this.capturingPosterSubject.next(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (blob) => {
        this.posterChange.emit(blob);
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

  formatTime(milliseconds: number | null | undefined): string {
    const totalSeconds = Math.max(
      0,
      Math.floor(Number(milliseconds ?? 0) / 1000)
    );
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
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
    this.metadataSubject.next(null);
    this.form.reset({
      trimStartMs: 0,
      trimEndMs: 0,
      aspectRatio: 'ORIGINAL',
      muteAudio: false,
    });
  }
}
