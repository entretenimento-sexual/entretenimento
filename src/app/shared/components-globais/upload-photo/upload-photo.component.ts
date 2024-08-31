// src/app/shared/components-globais/upload-photo/upload-photo.component.ts
import { Component, EventEmitter, Output } from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import imageCompression from 'browser-image-compression';

@Component({
  selector: 'app-upload-photo',
  templateUrl: './upload-photo.component.html',
  styleUrls: ['./upload-photo.component.css']
})
export class UploadPhotoComponent {
  @Output() photoSelected = new EventEmitter<File>();
  selectedImageFile!: File;
  isLoading = false; // Flag para indicar o processamento
  errorMessage: string = ''; // Mensagem de erro para feedback ao usuário

  // Lista de tipos de arquivos permitidos
  allowedFileTypes: string[] = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/tiff',
    'image/svg+xml',
    'image/x-icon',
    'image/heic',
    'image/heif',
  ];

  constructor(public activeModal: NgbActiveModal) { }

  async onFileSelected(event: any): Promise<void> {
    const file: File = event.target.files[0];

    if (!this.allowedFileTypes.includes(file.type)) {
      this.errorMessage = 'Tipo de arquivo não suportado. Por favor, selecione uma imagem.';
      return;
    }

    const maxSizeInMB = 5;
    const minSizeInKB = 100; // Tamanho mínimo desejado

    if (file.size / 1024 < minSizeInKB) {
      this.errorMessage = `A imagem é muito pequena. O tamanho mínimo é de ${minSizeInKB} KB.`;
      return;
    }

    this.isLoading = true; // Ativa o spinner de carregamento
    this.errorMessage = ''; // Limpa qualquer mensagem de erro anterior

    try {
      let selectedFile = file;

      if (file.size / 1024 / 1024 > maxSizeInMB) {
        const options = {
          maxSizeMB: maxSizeInMB,
          maxWidthOrHeight: 1920,
          useWebWorker: true,
        };
        const compressedBlob = await imageCompression(file, options);
        console.log(`Imagem foi reduzida para: ${compressedBlob.size / 1024 / 1024} MB`);
        selectedFile = new File([compressedBlob], file.name, { type: file.type, lastModified: Date.now() });
      }

      this.photoSelected.emit(selectedFile);
      this.activeModal.close();
    } catch (error) {
      console.error('Erro ao processar a imagem:', error);
      this.errorMessage = 'Ocorreu um erro ao processar a imagem. Tente novamente.';
    } finally {
      this.isLoading = false; // Desativa o spinner
    }
  }

  onFileSelect(): void {
    if (this.selectedImageFile) {
      this.photoSelected.emit(this.selectedImageFile);
      this.activeModal.close();
    }
  }
}
