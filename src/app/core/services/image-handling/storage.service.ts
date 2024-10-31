// src/app/core/services/storage.service.ts
import { Injectable } from '@angular/core';
import {
  getStorage, ref, uploadBytes, getDownloadURL, deleteObject, uploadBytesResumable
} from 'firebase/storage';
import { from, Observable, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { ErrorNotificationService } from '../error-handler/error-notification.service';
import { Store } from '@ngrx/store';
import { uploadStart, uploadSuccess, uploadError, uploadProgress } from '../../../store/actions/actions.user/file.actions';
import { AppState } from 'src/app/store/states/app.state';

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private storage = getStorage();

  constructor(private errorNotifier: ErrorNotificationService,
              private store: Store<AppState>) { }

  // Método genérico para upload de arquivos com progresso
  uploadFile(file: File, path: string, userId: string): Observable<string> {
    const storageRef = ref(this.storage, path);
    const uploadTask = uploadBytesResumable(storageRef, file);

    return new Observable<string>(observer => {
      uploadTask.on('state_changed',
        snapshot => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          this.store.dispatch(uploadProgress({ progress }));
        },
        error => {
          this.store.dispatch(uploadError({ error: error.message }));
          this.errorNotifier.showError('Erro no upload da foto.');
          observer.error(error);
        },
        () => {
          getDownloadURL(uploadTask.snapshot.ref).then(downloadUrl => {
            this.store.dispatch(uploadSuccess({ url: downloadUrl }));
            observer.next(downloadUrl);
            observer.complete();
          }).catch(error => {
            this.store.dispatch(uploadError({ error: error.message }));
            observer.error(error);
          });
        }
      );
    }).pipe(
      catchError(error => {
        // Tratamento adicional de erros, se necessário
        return from(Promise.reject(error));
      })
    );
  }

  // Método específico para upload de avatar
  uploadAvatar(file: File, userId: string): Observable<string> {
    const avatarPath = `user_profiles/${userId}/avatar.jpg`;
    return this.uploadFile(file, avatarPath, userId).pipe(
      catchError(error => {
        this.errorNotifier.showError('Erro no upload do avatar.');
        return of('');
      })
    );
  }

  // Método para carregar a URL de uma foto existente
  getPhotoUrl(path: string): Observable<string> {
    const storageRef = ref(this.storage, path);

    return from(getDownloadURL(storageRef)).pipe(
      catchError(error => {
        this.errorNotifier.showError('Erro ao carregar a foto.');
        return of('');
      })
    );
  }

  // Método para substituir uma foto existente no Firebase Storage
  replaceFile(file: File, path: string): Observable<string> {
    const storageRef = ref(this.storage, path);

    return from(uploadBytes(storageRef, file)).pipe(
      switchMap(snapshot => from(getDownloadURL(snapshot.ref))),
      map(downloadUrl => {
        this.errorNotifier.showSuccess('Foto substituída com sucesso!');
        return downloadUrl;
      }),
      catchError(error => {
        this.errorNotifier.showError('Erro ao substituir a foto.');
        return of('');
      })
    );
  }

  // Método para deletar arquivos
  deleteFile(path: string): Observable<void> {
    const storageRef = ref(this.storage, path);

    return from(deleteObject(storageRef)).pipe(
      map(() => this.errorNotifier.showSuccess('Foto deletada com sucesso!')),
      catchError(error => {
        this.errorNotifier.showError('Erro ao deletar a foto.');
        return of();
      })
    );
  }
}
