// src/app/dashboard/principal/principal.component.ts
import { Component } from '@angular/core';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { UploadPhotoComponent } from 'src/app/shared/components-globais/upload-photo/upload-photo.component';
import { PhotoEditorComponent } from 'src/app/photo-editor/photo-editor/photo-editor.component';

@Component({
  selector: 'app-principal',
  templateUrl: './principal.component.html',
  styleUrls: ['./principal.component.css']
})
export class PrincipalComponent {
  selectedImageFile!: File;

  constructor(private modalService: NgbModal) { }

  onUploadPhotoClick(): void {
    const modalRef = this.modalService.open(UploadPhotoComponent, { size: 'lg' });

    modalRef.componentInstance.photoSelected.subscribe((file: File) => {
      console.log('Arquivo selecionado:', file);
      this.selectedImageFile = file;
      this.openPhotoEditorWithFile(this.selectedImageFile);
    });
  }

  openPhotoEditorWithFile(file: File): void {
    console.log('Abrindo editor com o arquivo:', file);
    const editorModalRef = this.modalService.open(PhotoEditorComponent, { size: 'lg' });
    editorModalRef.componentInstance.imageFile = file;
  }
}
