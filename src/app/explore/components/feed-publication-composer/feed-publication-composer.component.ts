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
import {
  IPhotoUploadSuccessEvent,
  PhotoUploadFlowService,
} from 'src/app/core/services/image-handling/photo-upload-flow.service';
import { MediaPublicationService } from 'src/app/core/services/media/media-publication.service';

const MAX_CAPTION_LENGTH = 800;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

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
  readonly previewUrl = signal<string | null>(null);
  readonly publishing = signal(false);
  readonly progress = signal(0);

  readonly maxCaptionLength = MAX_CAPTION_LENGTH;

  constructor() {
    this.destroyRef.onDestroy(() => this.revokePreviewUrl());
  }

  openFilePicker(): void {
    if (!this.publishing()) {
      this.fileInput?.nativeElement.click();
    }
  }

  onFileSelected(event: Event): void {
    const inputElement = event.target as HTMLInputElement | null;
    const file = inputElement?.files?.[0] ?? null;

    if (!file) return;

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      this.notifications.showWarning('Envie uma imagem JPG, PNG ou WEBP.');
      if (inputElement) inputElement.value = '';
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      this.notifications.showWarning('A imagem deve ter no máximo 10 MB.');
      if (inputElement) inputElement.value = '';
      return;
    }

    this.revokePreviewUrl();
    this.selectedFile.set(file);
    this.previewUrl.set(URL.createObjectURL(file));
    this.progress.set(0);
  }

  removeSelectedPhoto(): void {
    if (this.publishing()) return;

    this.revokePreviewUrl();
    this.selectedFile.set(null);
    this.progress.set(0);

    if (this.fileInput) {
      this.fileInput.nativeElement.value = '';
    }
  }

  publish(): void {
    if (this.publishing()) return;

    const currentUser = this.user();
    const file = this.selectedFile();
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
      })
      .pipe(
        tap((event) => {
          if (event.type === 'progress') {
            this.progress.set(event.progress);
          }
        }),
        filter(
          (event): event is IPhotoUploadSuccessEvent => event.type === 'success'
        ),
        take(1),
        switchMap((event) => {
          const photo: IPhotoItem = {
            id: event.result.photoId,
            ownerUid,
            url: event.result.url,
            path: event.result.path,
            fileName: event.result.fileName,
            createdAt: event.result.createdAt.getTime(),
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
          this.reportError(error);
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
    if (this.publishing()) return;
    this.reset();
    this.closed.emit();
  }

  private reset(): void {
    this.revokePreviewUrl();
    this.selectedFile.set(null);
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

  private reportError(error: unknown): void {
    this.notifications.showError(
      'A foto foi preservada na sua biblioteca, mas não pôde ser publicada agora.'
    );

    try {
      const normalized =
        error instanceof Error
          ? error
          : new Error('Falha ao criar publicação persistente.');
      const contextual = normalized as Error & {
        context?: Record<string, unknown>;
        original?: unknown;
        skipUserNotification?: boolean;
      };

      contextual.original = error;
      contextual.context = {
        scope: 'FeedPublicationComposerComponent',
        op: 'publish',
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // O feedback visual já foi emitido.
    }
  }
}
