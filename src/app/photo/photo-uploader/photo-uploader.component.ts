//src\app\photo\photo-uploader\photo-uploader.component.ts
import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

@Component({
  selector: 'app-photo-uploader',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './photo-uploader.component.html',
  styleUrl: './photo-uploader.component.css'
})
export class PhotoUploaderComponent {
  selectedFile: File | null = null;
  uploadStatus: string | null = null;

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
      // Aqui você implementaria a lógica de upload
      // Por exemplo, enviando o arquivo para um servidor ou Firebase Storage
      this.uploadStatus = 'Enviando...';

      // Após o upload:
      // this.uploadStatus = 'Upload concluído com sucesso!';
    } else {
      this.uploadStatus = 'Nenhum arquivo selecionado.';
    }
  }
}
