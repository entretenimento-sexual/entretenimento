//src\app\photo\photo-viewer\photo-viewer.component.ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-photo-viewer',
  standalone: true,
  imports: [],
  templateUrl: './photo-viewer.component.html',
  styleUrl: './photo-viewer.component.css'
})
export class PhotoViewerComponent {
  currentPhotoUrl: string;
  photoList: string[]; // Array com URLs das fotos
  currentIndex: number; // Índice da foto atual

  constructor() {
    // Inicializações
    this.photoList = []; // Substitua com suas URLs de fotos
    this.currentIndex = 0;
    this.currentPhotoUrl = this.photoList[this.currentIndex];
  }

  nextPhoto() {
    if (this.currentIndex < this.photoList.length - 1) {
      this.currentIndex++;
      this.currentPhotoUrl = this.photoList[this.currentIndex];
    }
  }

  previousPhoto() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.currentPhotoUrl = this.photoList[this.currentIndex];
    }
  }
}
