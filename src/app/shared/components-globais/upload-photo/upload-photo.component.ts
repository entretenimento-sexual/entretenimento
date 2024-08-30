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

  // Lista de tipos de arquivos permitidos
  allowedFileTypes: string[] = [
    'image/jpeg',  // JPEG
    'image/png',   // PNG
    'image/gif',   // GIF
    'image/webp',  // WebP
    'image/bmp',   // BMP (Bitmap)
    'image/tiff',  // TIFF (Tagged Image File Format)
    'image/svg+xml',  // SVG (Scalable Vector Graphics)
    'image/x-icon',   // ICO (Icon files)
    'image/heic',  // HEIC (High Efficiency Image Format, usado por iPhones)
    'image/heif',  // HEIF (High Efficiency Image Format)
  ];

  constructor(public activeModal: NgbActiveModal) { }

  onFileSelected(event: any): void {
    const file: File = event.target.files[0];

    if (!this.allowedFileTypes.includes(file.type)) {
      alert('Tipo de arquivo não suportado. Por favor, selecione uma imagem.');
      return;
    }

    const maxSizeInMB = 5; // Tamanho máximo permitido em MB

    const options = {
      maxSizeMB: maxSizeInMB,
      maxWidthOrHeight: 1920, // Defina o valor que desejar para redimensionamento
      useWebWorker: true,
    };

    imageCompression(file, options)
      .then((compressedBlob) => {
        console.log(`Imagem foi reduzida para: ${compressedBlob.size / 1024 / 1024} MB`);

        // Converte o Blob comprimido de volta para File
        const compressedFile = new File([compressedBlob], file.name, {
          type: file.type,
          lastModified: Date.now(),
        });

        // Atualiza a imagem selecionada
        this.selectedImageFile = compressedFile;

        // Emite o arquivo comprimido para o componente pai
        this.photoSelected.emit(this.selectedImageFile);

        // Fecha o modal após a seleção e compressão da imagem
        this.activeModal.close();
      })
      .catch((error) => {
        console.error('Erro ao comprimir a imagem:', error);
      });
  }

  uploadFile(file: File): void {
    // Sua lógica de upload aqui
    // exibe a mensagem de sucesso
    console.log('Foto salva com sucesso!');
  }

  onFileSelect(): void {
    if (this.selectedImageFile) {
      this.photoSelected.emit(this.selectedImageFile);
      this.activeModal.close();
    }
  }
}
