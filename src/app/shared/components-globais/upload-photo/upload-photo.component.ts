// src/app/shared/components-globais/upload-photo/upload-photo.component.ts
import { Component, EventEmitter, Output } from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { PhotoService } from 'src/app/core/services/image-handling/photo.service';

@Component({
  selector: 'app-upload-photo',
  templateUrl: './upload-photo.component.html',
  styleUrls: ['./upload-photo.component.css']
})
export class UploadPhotoComponent {
  @Output() photoSelected = new EventEmitter<File>();
  selectedImageFile: File | null = null;
  isLoading = false;
  errorMessage: string | null = '';

  constructor(public activeModal: NgbActiveModal,
    private photoService: PhotoService) { }

  async onFileSelected(event: any): Promise<void> {
    if (!event.target.files || event.target.files.length === 0) {
      this.errorMessage = 'Nenhum arquivo selecionado';
      return;
    }

    const file: File = event.target.files[0];

    // Validação do tipo de arquivo (exemplo: apenas imagens)
    if (!file.type.startsWith('image/')) {
      this.errorMessage = 'Por favor, selecione uma imagem válida.';
      this.isLoading = false;
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    try {
      this.selectedImageFile = await this.photoService.processFile(file);
      this.photoSelected.emit(this.selectedImageFile);
      this.closeModal('success');
    } catch (error) {
      this.errorMessage = (error as Error).message;
    } finally {
      this.isLoading = false;
    }
  }

  closeModal(reason: 'success' | 'error' | 'cancel') {
    this.isLoading = false;
    this.errorMessage = null;
    this.activeModal.close(reason);
  }
}
