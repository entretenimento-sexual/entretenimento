import { Component } from '@angular/core';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { UploadPhotoComponent } from 'src/app/shared/components-globais/upload-photo/upload-photo.component';

@Component({
  selector: 'app-principal',
  templateUrl: './principal.component.html',
  styleUrls: ['./principal.component.css']
})
export class PrincipalComponent {

  constructor(private modalService: NgbModal) { }

  onUploadPhotoClick(): void {
    this.openPhotoEditor();
  }

  onTakePhotoClick(): void {
    this.openPhotoEditor(true);
  }

  openPhotoEditor(isTakingPhoto: boolean = false): void {
    this.modalService.open(UploadPhotoComponent, { size: 'lg' });
    if (isTakingPhoto) {
      console.log('Modo de tirar foto ativado');
    }
  }
}
