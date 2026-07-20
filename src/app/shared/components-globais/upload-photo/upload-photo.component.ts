// src/app/shared/components-globais/upload-photo/upload-photo.component.ts
import { ChangeDetectionStrategy, Component, EventEmitter, Output } from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

import { PhotoService } from 'src/app/core/services/image-handling/photo.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

@Component({
  selector: 'app-upload-photo',
  templateUrl: './upload-photo.component.html',
  styleUrls: ['./upload-photo.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class UploadPhotoComponent {
  @Output() photoSelected = new EventEmitter<File>();

  selectedImageFile: File | null = null;
  isLoading = false;
  errorMessage: string | null = null;

  readonly maxUploadMegabytes = MAX_UPLOAD_BYTES / 1024 / 1024;

  constructor(
    public readonly activeModal: NgbActiveModal,
    private readonly photoService: PhotoService,
    private readonly notify: ErrorNotificationService,
    private readonly globalError: GlobalErrorHandlerService
  ) {}

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] ?? null;

    if (this.isLoading) return;

    const validationMessage = this.validateFile(file);
    if (validationMessage) {
      this.errorMessage = validationMessage;
      if (input) input.value = '';
      return;
    }

    this.isLoading = true;
    this.errorMessage = null;
    this.selectedImageFile = null;

    try {
      const processedFile = await this.photoService.processFile(file as File);
      this.selectedImageFile = processedFile;
      this.photoSelected.emit(processedFile);
      this.isLoading = false;
      this.closeModal('success', true);
    } catch (error) {
      this.errorMessage =
        'Não foi possível preparar esta imagem. Tente outra foto em JPG, PNG ou WebP.';
      this.reportError(error);
      this.notify.showError('Não foi possível preparar a foto selecionada.');
    } finally {
      this.isLoading = false;
      if (input) input.value = '';
    }
  }

  closeModal(
    reason: 'success' | 'error' | 'cancel',
    force = false
  ): void {
    if (this.isLoading && !force) return;

    this.isLoading = false;
    this.errorMessage = null;
    this.activeModal.close(reason);
  }

  private validateFile(file: File | null): string | null {
    if (!file) {
      return 'Selecione uma imagem para continuar.';
    }

    if (file.size <= 0) {
      return 'O arquivo selecionado está vazio.';
    }

    if (!ACCEPTED_IMAGE_TYPES.has(file.type.toLowerCase())) {
      return 'Use uma imagem nos formatos JPG, PNG ou WebP.';
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return `A imagem deve ter no máximo ${this.maxUploadMegabytes} MB.`;
    }

    return null;
  }

  private reportError(error: unknown): void {
    try {
      const normalized = error instanceof Error
        ? error
        : new Error('Falha ao processar upload de foto.');
      const contextual = normalized as Error & {
        context?: unknown;
        skipUserNotification?: boolean;
      };

      contextual.context = {
        scope: 'UploadPhotoComponent',
        operation: 'processFile',
        fileType: this.selectedImageFile?.type ?? null,
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // Falha secundária de telemetria não interrompe o feedback do modal.
    }
  }
}
