// src/app/shared/components-globais/upload-photo/upload-photo.component.ts
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Output,
} from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
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
    public readonly activeModal: NgbActiveModal
  ) {}

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] ?? null;

    const validation = validateImageMediaFile(file, 'default');
    if (!validation.valid) {
      this.errorMessage =
        validation.userMessage ?? 'A imagem selecionada não é válida.';
      if (input) input.value = '';
      return;
    }

    const selectedFile = file as File;
    this.errorMessage = null;
    this.selectedImageFile = selectedFile;
    this.photoSelected.emit(selectedFile);

    if (input) {
      input.value = '';
    }

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


}
