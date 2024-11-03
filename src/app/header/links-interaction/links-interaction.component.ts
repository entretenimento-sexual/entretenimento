//src\app\header\links-interaction\links-interaction.component.ts
import { Component, OnInit } from '@angular/core';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { UploadPhotoComponent } from 'src/app/shared/components-globais/upload-photo/upload-photo.component';
import { PhotoEditorComponent } from 'src/app/photo-editor/photo-editor/photo-editor.component';

@Component({
  selector: 'app-links-interaction',
  templateUrl: './links-interaction.component.html',
  styleUrls: ['./links-interaction.component.css']
})
export class LinksInteractionComponent implements OnInit {
  selectedImageFile!: File;
  userId: string | null = null;

  constructor(private modalService: NgbModal, private authService: AuthService) { }

  ngOnInit(): void {
    // Obtenha o userId do usuário autenticado
    this.authService.user$.subscribe(user => {
      if (user) {
        this.userId = user.uid; // Capture o userId do usuário
      }
    });
  }

  onUploadPhotoClick(): void {
    const modalRef = this.modalService.open(UploadPhotoComponent, { size: 'lg' });

    modalRef.componentInstance.photoSelected.subscribe((file: File) => {
      this.selectedImageFile = file;
      this.openPhotoEditorWithFile(this.selectedImageFile);
    });
  }

  openPhotoEditorWithFile(file: File): void {
    const editorModalRef = this.modalService.open(PhotoEditorComponent, { size: 'lg' });
    editorModalRef.componentInstance.imageFile = file;
  }
}
