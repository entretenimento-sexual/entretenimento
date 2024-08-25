// src/app/shared/components-globais/upload-photo/upload-photo.component.ts
import { Component, EventEmitter, Output } from '@angular/core';

@Component({
  selector: 'app-upload-photo',
  templateUrl: './upload-photo.component.html',
  styleUrls: ['./upload-photo.component.css']
})
export class UploadPhotoComponent {
  @Output() photoSelected = new EventEmitter<File>();
  selectedImageFile!: File;

  onFileSelected(event: any): void {
    const file = event.target.files[0];
    if (file) {
      this.selectedImageFile = file;
    }
  }

  onFileSelect(): void {
    if (this.selectedImageFile) {
      this.photoSelected.emit(this.selectedImageFile);
    }
  }
}
