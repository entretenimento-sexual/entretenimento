//src\app\user-profile\user-photo-manager\user-photo-manager.component.ts
import { Component, OnInit } from '@angular/core';
import { PhotoFirestoreService } from 'src/app/core/services/image-handling/photo-firestore.service';
import { Observable } from 'rxjs';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { StorageService } from 'src/app/core/services/image-handling/storage.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

@Component({
  selector: 'app-user-photo-manager',
  templateUrl: './user-photo-manager.component.html',
  styleUrls: ['./user-photo-manager.component.css']
})
export class UserPhotoManagerComponent implements OnInit {
  userPhotos$: Observable<any[]> = new Observable();
  userId: string = '';

  constructor(private photoService: PhotoFirestoreService,
              private storageService: StorageService,
              private authService: AuthService,
              private errorHandler: GlobalErrorHandlerService) { }

  ngOnInit(): void {
    this.authService.user$.subscribe(user => {
      if (user && user.uid) {
        this.userId = user.uid;
        this.loadUserPhotos();
      }
    });
  }

  loadUserPhotos() {
    this.userPhotos$ = this.photoService.getPhotosByUser(this.userId);
  }

  // Função ajustada para deletar a foto corretamente
  deleteFile(photoId: string, photoPath: string) {
    if (confirm('Tem certeza que deseja excluir esta foto?')) {
      this.photoService.deletePhoto(this.userId, photoId, photoPath).catch(error => {
        this.errorHandler.handleError(error);
      });
    }
  }
  }

