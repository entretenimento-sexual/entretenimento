//src\app\user-profile\user-photo-manager\user-photo-manager.component.ts
import { Component, OnInit } from '@angular/core';
import { PhotoFirestoreService } from 'src/app/core/services/image-handling/photo-firestore.service';
import { Observable } from 'rxjs';
import { AuthService } from 'src/app/core/services/autentication/auth.service';

@Component({
  selector: 'app-user-photo-manager',
  templateUrl: './user-photo-manager.component.html',
  styleUrls: ['./user-photo-manager.component.css']
})
export class UserPhotoManagerComponent implements OnInit {
  userPhotos$: Observable<any[]> = new Observable();
  userId: string = '';

  constructor(private photoService: PhotoFirestoreService,
              private authService: AuthService
  ) { }

  ngOnInit(): void {
    this.authService.getUserAuthenticated().subscribe(user => {
      if (user && user.uid) {
        this.userId = user.uid;
        this.loadUserPhotos();
      }
    });
  }

  loadUserPhotos() {
    this.userPhotos$ = this.photoService.getPhotosByUser(this.userId);
  }

  deletePhoto(photoId: string, photoPath: string) {
    if (confirm('Tem certeza que deseja excluir esta foto?')) {
      if (this.userId) {
        this.photoService.deletePhoto(this.userId, photoId, photoPath).then(() => {
          alert('Foto excluída com sucesso!');
          this.loadUserPhotos(); // Reload photos after deletion
        }).catch(error => {
          console.error('Erro ao excluir a foto:', error);
          alert('Erro ao excluir a foto.');
        });
      }
    }
  }
}
