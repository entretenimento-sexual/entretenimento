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
  selectedImageFile!: File;
  isLoading = false;
  errorMessage: string = '';

  constructor(public activeModal: NgbActiveModal, private photoService: PhotoService) { }

  async onFileSelected(event: any): Promise<void> {
    const file: File = event.target.files[0];

    this.isLoading = true;
    this.errorMessage = '';

    try {
      this.selectedImageFile = await this.photoService.processFile(file);
      this.photoSelected.emit(this.selectedImageFile);
      this.activeModal.close();
    } catch (error) {
      this.errorMessage = (error as Error).message;
    } finally {
      this.isLoading = false;
    }
  }
}
