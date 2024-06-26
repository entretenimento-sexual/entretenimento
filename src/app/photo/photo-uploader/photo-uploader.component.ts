// src\app\photo\photo-uploader\photo-uploader.component.ts
import { Component } from '@angular/core';
import { PhotoUploadService } from '../services-photo/photo-upload.service';
import { PhotoErrorHandlerService } from '../services-photo/photo-error-handler.service';

@Component({
  selector: 'app-photo-uploader',
  templateUrl: './photo-uploader.component.html',
  styleUrls: ['./photo-uploader.component.css']
})
export class PhotoUploaderComponent {
  selectedFile: File | null = null;
  uploadStatus: string | null = null;

  constructor(
    private photoUploadService: PhotoUploadService,
    private errorHandler: PhotoErrorHandlerService
  ) { }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;

    if (input.files && input.files[0]) {
      this.selectedFile = input.files[0];
    } else {
      this.selectedFile = null;
    }
  }

  uploadPhoto() {
    if (this.selectedFile) {
      this.uploadStatus = 'Enviando...';
      this.photoUploadService.uploadPhoto(this.selectedFile).then(
        (url) => {
          this.uploadStatus = 'Upload concluído com sucesso!';
          console.log(`Foto enviada: ${url}`);
        },
        (error) => {
          this.uploadStatus = 'Erro ao enviar foto.';
          this.errorHandler.handleError(error);
          console.error(error);
        }
      );
    } else {
      this.uploadStatus = 'Nenhum arquivo selecionado.';
    }
  }
}
