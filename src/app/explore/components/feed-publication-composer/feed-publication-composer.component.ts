import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { EMPTY } from 'rxjs';
import { catchError, filter, finalize, switchMap, take, tap } from 'rxjs/operators';

import { IPhotoItem } from 'src/app/core/interfaces/media/i-photo-item';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PhotoEditorLauncherService } from 'src/app/core/services/image-handling/photo-editor-launcher.service';
import type {
  PhotoEditorContext,
  PhotoEditorPreset,
} from 'src/app/core/services/image-handling/photo-editor-result.model';
import {
  IPhotoUploadSuccessEvent,
  PhotoUploadFlowService,
} from 'src/app/core/services/image-handling/photo-upload-flow.service';
import {
  MEDIA_IMAGE_ACCEPT,
  MEDIA_IMAGE_FORMAT_LABEL,
  resolveImageMaxBytes,
  validateImageMediaFile,
  type ImageMediaContext,
} from 'src/app/core/services/media/media-format.policy';
import { MediaPublicationService } from 'src/app/core/services/media/media-publication.service';

const MAX_CAPTION_LENGTH = 800;
const EXPLORE_IMAGE_MEDIA_CONTEXT: ImageMediaContext = 'default';
const EXPLORE_EDITOR_CONTEXT: PhotoEditorContext = 'social-feed';
const EXPLORE_EDITOR_PRESET: PhotoEditorPreset = 'social-feed';

@Component({
  selector: 'app-feed-publication-composer',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './feed-publication-composer.component.html',
  styleUrl: './feed-publication-composer.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeedPublicationComposerComponent {
  @ViewChild('fileInput')
  private fileInput?: ElementRef<HTMLInputElement>;

  private readonly destroyRef = inject(DestroyRef);
  private readonly photoEditor = inject(PhotoEditorLauncherService);
  private readonly uploadFlow = inject(PhotoUploadFlowService);
  private readonly publication = inject(MediaPublicationService);
  private readonly notifications = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  readonly user = input<IUserDados | null>(null);
  readonly closed = output<void>();
  readonly published = output<void>();

  readonly captionControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(MAX_CAPTION_LENGTH)],
  });

  readonly selectedFile = signal<File | null>(null);
  readonly selectedImageState = signal<string | null>(null);
  readonly previewUrl = signal<string | null>(null);
  readonly editingPhoto = signal(false);
  readonly publishing = signal(false);
  readonly progress = signal(0);

  readonly maxCaptionLength = MAX_CAPTION_LENGTH;
  readonly imageAccept = MEDIA_IMAGE_ACCEPT;
  readonly imageFormatLabel = MEDIA_IMAGE_FORMAT_LABEL;
  readonly imageMaxMegabytes =
    resolveImageMaxBytes(EXPLORE_IMAGE_MEDIA_CONTEXT) / 1024 / 1024;

  constructor() {
    this.destroyRef.onDestroy(() => this.revokePreviewUrl());
  }

  openFilePicker(): void {
    if (!this.publishing() && !this.editingPhoto()) {
      this.fileInput?.nativeElement.click();
    }
  }

  onFileSelected(event: Event): void {
    const inputElement = event.target as HTMLInputElement | null;
    const file = inputElement?.files?.[0] ?? null;

    if (!file || this.publishing() || this.editingPhoto()) {
      return;
    }

    const validation = validateImageMediaFile(file, EXPLORE_IMAGE_MEDIA_CONTEXT);
    if (!validation.valid) {
      this.notifications.showWarning(
        validation.userMessage ?? 'A imagem selecionada não é válida.'
      );
      if (inputElement) inputElement.value = '';
      return;
    }

    this.editingPhoto.set(true);

    this.photoEditor
      .editFile$(file, {
        source: 'explore-publication',
        context: EXPLORE_EDITOR_CONTEXT,
        preset: EXPLORE_EDITOR_PRESET,
      })
      .pipe(
        take(1),
        catchError((error: unknown) => {
          this.notifications.showError(
            'Não foi possível abrir o editor para esta foto.'
          );
          this.reportTechnicalError(error, 'editImage', {
            mimeType: file.type,
            size: file.size,
          });
          return EMPTY;
        }),
        finalize(() => {
          this.editingPhoto.set(false);
          if (inputElement) inputElement.value = '';
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((result) => {
        if (!result) {
          return;
        }

        const processedValidation = validateImageMediaFile(
          result.file,
          EXPLORE_IMAGE_MEDIA_CONTEXT
        );
        if (!processedValidation.valid) {
          this.notifications.showError(
            processedValidation.userMessage ?? 'A imagem editada não é válida.'
          );
          this.reportTechnicalError(
            new Error(
              'O editor canônico devolveu uma imagem fora da política social-feed.'
            ),
            'validateEditedImage',
            {
              mimeType: result.file.type,
              size: result.file.size,
            }
          );
          return;
        }

        this.applySelectedPhoto(result.file, result.imageStateStr);
      });
  }

  removeSelectedPhoto(): void {
    if (this.publishing() || this.editingPhoto()) return;

    this.revokePreviewUrl();
    this.selectedFile.set(null);
    this.selectedImageState.set(null);
    this.progress.set(0);

    if (this.fileInput) {
      this.fileInput.nativeElement.value = '';
    }
  }

  publish(): void {
    if (this.publishing() || this.editingPhoto()) return;

    const currentUser = this.user();
    const file = this.selectedFile();
    const imageStateStr = this.selectedImageState();
    const ownerUid = String(currentUser?.uid ?? '').trim();

    this.captionControl.markAsTouched();

    if (!ownerUid) {
      this.notifications.showWarning('Entre novamente para publicar.');
      return;
    }

    if (!file) {
      this.notifications.showWarning('Escolha uma foto para a publicação.');
      return;
    }

    if (this.captionControl.invalid) {
      this.notifications.showWarning(
        `A legenda deve ter no máximo ${MAX_CAPTION_LENGTH} caracteres.`
      );
      return;
    }

    const caption = this.normalizeCaption(this.captionControl.value);

    this.publishing.set(true);
    this.progress.set(0);

    this.uploadFlow
      .uploadProcessedPhotoWithProgress$({
        userId: ownerUid,
        processedFile: file,
        originalFileName: file.name,
        mimeType: file.type,
        imageStateStr: imageStateStr ?? undefined,
      })
      .pipe(
        tap((uploadEvent) => {
          if (uploadEvent.type === 'progress') {
            this.progress.set(uploadEvent.progress);
          }
        }),
        filter(
          (uploadEvent): uploadEvent is IPhotoUploadSuccessEvent =>
            uploadEvent.type === 'success'
        ),
        take(1),
        switchMap((uploadEvent) => {
          const photo: IPhotoItem = {
            id: uploadEvent.result.photoId,
            ownerUid,
            url: uploadEvent.result.url,
            path: uploadEvent.result.path,
            fileName: uploadEvent.result.fileName,
            createdAt: uploadEvent.result.createdAt.getTime(),
            alt: caption || 'Foto publicada no perfil',
          };

          return this.publication.publishPhoto$({
            ownerUid,
            photo,
            visibility: 'PUBLIC',
            caption,
            commentsEnabled: true,
            commentsPolicy: 'EVERYONE',
            reactionsEnabled: true,
          });
        }),
        catchError((error: unknown) => {
          this.notifications.showError(
            'A foto foi preservada na sua biblioteca, mas não pôde ser publicada agora.'
          );
          this.reportTechnicalError(error, 'publish');
          return EMPTY;
        }),
        finalize(() => this.publishing.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        this.notifications.showSuccess('Publicação enviada.');
        this.reset();
        this.published.emit();
      });
  }

  cancel(): void {
    if (this.publishing() || this.editingPhoto()) return;
    this.reset();
    this.closed.emit();
  }

  private applySelectedPhoto(file: File, imageStateStr: string): void {
    this.revokePreviewUrl();
    this.selectedFile.set(file);
    this.selectedImageState.set(imageStateStr);
    this.previewUrl.set(URL.createObjectURL(file));
    this.progress.set(0);
  }

  private reset(): void {
    this.revokePreviewUrl();
    this.selectedFile.set(null);
    this.selectedImageState.set(null);
    this.captionControl.reset('');
    this.progress.set(0);

    if (this.fileInput) {
      this.fileInput.nativeElement.value = '';
    }
  }

  private normalizeCaption(value: unknown): string | null {
    const caption = String(value ?? '')
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_CAPTION_LENGTH);

    return caption || null;
  }

  private revokePreviewUrl(): void {
    const currentUrl = this.previewUrl();

    if (currentUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(currentUrl);
    }

    this.previewUrl.set(null);
  }

  private reportTechnicalError(
    error: unknown,
    op: 'editImage' | 'validateEditedImage' | 'publish',
    context?: Record<string, unknown>
  ): void {
    try {
      const normalized =
        error instanceof Error
          ? error
          : new Error('Falha no fluxo de publicação de foto do Explorar.');
      const contextual = normalized as Error & {
        context?: Record<string, unknown>;
        original?: unknown;
        skipUserNotification?: boolean;
      };

      contextual.original = error;
      contextual.context = {
        scope: 'FeedPublicationComposerComponent',
        op,
        ...(context ?? {}),
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // O feedback visual já foi emitido pelo ErrorNotificationService.
    }
  }
}
