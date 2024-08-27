// src/app/shared/components-globais/upload-photo/upload-photo.component.ts
import { Component, EventEmitter, Output } from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

@Component({
  selector: 'app-upload-photo',
  templateUrl: './upload-photo.component.html',
  styleUrls: ['./upload-photo.component.css']
})

export class UploadPhotoComponent {
  @Output() photoSelected = new EventEmitter<File>();
  selectedImageFile!: File;

  constructor(public activeModal: NgbActiveModal) { }

  onFileSelected(event: any): void {
    const file = event.target.files[0];
    if (file) {
      this.photoSelected.emit(file);
      this.activeModal.close();
    }
  }

  onFileSelect(): void {
    if (this.selectedImageFile) {
      this.photoSelected.emit(this.selectedImageFile);
      this.activeModal.close();
    }
  }
}
