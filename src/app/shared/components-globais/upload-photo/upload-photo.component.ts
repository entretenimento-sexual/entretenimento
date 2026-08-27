// src/app/shared/components-globais/upload-photo/upload-photo.component.ts
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Output,
} from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom, of } from 'rxjs';
import { catchError, finalize, take } from 'rxjs/operators';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PhotoEditorLauncherService } from 'src/app/core/services/image-handling/photo-editor-launcher.service';
import {
  MEDIA_IMAGE_ACCEPT,
  MEDIA_IMAGE_FORMAT_LABEL,
  resolveImageMaxBytes,
  validateImageMediaFile,
} from 'src/app/core/services/media/media-format.policy';

@Component({
  selector: 'app-upload-photo',
  templateUrl: './upload-photo.component.html',
  styleUrls: ['./upload-photo.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class UploadPhotoComponent {
  // API pública preservada: consumidores continuam recebendo somente o File
  // processado. O estado interno do editor permanece encapsulado no fluxo canônico.
  @Output() photoSelected = new EventEmitter<File>();

  selectedImageFile: File | null = null;
  isLoading = false;
  errorMessage: string | null = null;

  readonly imageAccept = MEDIA_IMAGE_ACCEPT;
  readonly imageFormatLabel = MEDIA_IMAGE_FORMAT_LABEL;
  readonly maxUploadMegabytes = resolveImageMaxBytes('default') / 1024 / 1024;

  constructor(
    public readonly activeModal: NgbActiveModal,
    private readonly photoEditor: PhotoEditorLauncherService,
    private readonly notify: ErrorNotificationService,
    private readonly globalError: GlobalErrorHandlerService
  ) {}

  /**
   * Mantém o contrato Promise<void> legado, mas delega o processamento real ao
   * pipeline reativo canônico: política de mídia -> editor -> photoSelected.
   */
  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] ?? null;

    if (this.isLoading) return;

    const validation = validateImageMediaFile(file, 'default');
    if (!validation.valid) {
      this.errorMessage =
        validation.userMessage ?? 'A imagem selecionada não é válida.';
      if (input) input.value = '';
      return;
    }

    const sourceFile = file as File;
    this.isLoading = true;
    this.errorMessage = null;
    this.selectedImageFile = null;

    const result = await firstValueFrom(
      this.photoEditor
        .editFile$(sourceFile, {
          source: 'global-photo-upload',
          context: 'generic',
          preset: 'free',
        })
        .pipe(
          take(1),
          catchError((error: unknown) => {
            this.errorMessage =
              'Não foi possível preparar esta imagem. Tente outra foto compatível.';
            this.notify.showError('Não foi possível preparar a foto selecionada.');
            this.reportError(error, sourceFile, 'editFile');
            return of(null);
          }),
          finalize(() => {
            this.isLoading = false;
            if (input) input.value = '';
          })
        )
    );

    if (!result) return;

    const processedValidation = validateImageMediaFile(result.file, 'default');
    if (!processedValidation.valid) {
      this.errorMessage =
        processedValidation.userMessage ?? 'A imagem editada não é válida.';
      this.notify.showError(this.errorMessage);
      this.reportError(
        new Error('O editor canônico devolveu uma imagem fora da política de mídia.'),
        result.file,
        'validateEditorResult'
      );
      return;
    }

    this.selectedImageFile = result.file;
    this.photoSelected.emit(result.file);
    this.closeModal('success', true);
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

  private reportError(
    error: unknown,
    file: File | null,
    operation: 'editFile' | 'validateEditorResult'
  ): void {
    try {
      const normalized =
        error instanceof Error
          ? error
          : new Error('Falha ao processar seleção de foto.');
      const contextual = normalized as Error & {
        context?: unknown;
        original?: unknown;
        skipUserNotification?: boolean;
      };

      contextual.original = error;
      contextual.context = {
        scope: 'UploadPhotoComponent',
        operation,
        fileName: file?.name ?? null,
        fileType: file?.type ?? null,
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // Falha secundária de telemetria não interrompe o feedback do modal.
    }
  }
}
