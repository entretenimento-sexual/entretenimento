//src\app\user-profile\user-photo-manager\user-photo-manager.component.ts
import { Component, OnInit } from '@angular/core';
import { PhotoFirestoreService } from 'src/app/core/services/image-handling/photo-firestore.service';
import { Observable } from 'rxjs';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { StorageService } from 'src/app/core/services/image-handling/storage.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { CommonModule } from '@angular/common';

@Component({
    selector: 'app-user-photo-manager',
    templateUrl: './user-photo-manager.component.html',
    styleUrls: ['./user-photo-manager.component.css'],
    standalone: true,
    imports: [CommonModule]
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

/*
auth.service.ts está sendo descuntinuado.
C:.
│   auth.service.ts
│   email-input-modal.service.ts
│   login.service.spec.ts
│   login.service.ts
│   social-auth.service.spec.ts
│   social-auth.service.ts
│
├───auth
│       access-control.service.ts
│       auth-app-block.service.ts
│       auth-orchestrator.service.ts
│       auth-return-url.service.ts
│       auth-session.service.ts
│       auth.facade.ts
│       auth.types.ts
│       current-user-store.service.ts
│       logout.service.ts
│
└───register
        email-verification.service.md
        email-verification.service.ts
        pre-register.service.ts
        register.service.spec.ts
        register.service.ts
        registerServiceREADME.md

PS C:\entretenimento\src\app\core\services\autentication>
*/
