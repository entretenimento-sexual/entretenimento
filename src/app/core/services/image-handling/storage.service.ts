//C:\entretenimento\src\app\core\services\image-handling\storage.service.ts
import { Injectable } from '@angular/core';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject, uploadBytesResumable } from 'firebase/storage';
import { from, Observable, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { ErrorNotificationService } from '../error-handler/error-notification.service';
import { Store } from '@ngrx/store';
import { uploadSuccess, uploadError, uploadProgress } from '../../../store/actions/actions.user/file.actions';
import { AppState } from 'src/app/store/states/app.state';
import { UsuarioService } from '../user-profile/usuario.service';

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private storage = getStorage();

  constructor(private errorNotifier: ErrorNotificationService,
    private store: Store<AppState>,
    private usuarioService: UsuarioService) { }

  private extractErrorMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'message' in error) {
      return (error as { message: string }).message;
    }
    return String(error);
  }

  uploadFile(file: File, path: string, userId: string): Observable<string> {
    console.log('[StorageService] Iniciando upload de arquivo:', { fileName: file.name, path, userId });
    const storageRef = ref(this.storage, path);
    const uploadTask = uploadBytesResumable(storageRef, file);

    return new Observable<string>(observer => {
      uploadTask.on('state_changed',
        snapshot => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          console.log('[StorageService] Progresso do upload:', progress);
          this.store.dispatch(uploadProgress({ progress }));
        },
        error => {
          const errorMsg = this.extractErrorMessage(error);
          console.log('[StorageService] Erro durante upload:', errorMsg);
          this.store.dispatch(uploadError({ error: errorMsg }));
          this.errorNotifier.showError('Erro no upload da foto.');
          observer.error(error);
        },
        () => {
          getDownloadURL(uploadTask.snapshot.ref).then(downloadUrl => {
            console.log('[StorageService] Upload concluído. URL obtida:', downloadUrl);
            this.store.dispatch(uploadSuccess({ url: downloadUrl }));
            observer.next(downloadUrl);
            observer.complete();
          }).catch(error => {
            const errorMsg = this.extractErrorMessage(error);
            console.log('[StorageService] Erro ao obter URL do download:', errorMsg);
            this.store.dispatch(uploadError({ error: errorMsg }));
            observer.error(error);
          });
        }
      );
    }).pipe(
      catchError(error => {
        const errorMsg = this.extractErrorMessage(error);
        console.log('[StorageService] Erro no fluxo do Observable uploadFile:', errorMsg);
        return from(Promise.reject(error));
      })
    );
  }

  uploadProfileAvatar(file: File, userId: string, progressCallback?: (progress: number) => void): Observable<string> {
    console.log('[StorageService] Iniciando uploadProfileAvatar para userId:', userId);
    const avatarPath = `avatars/${userId}.jpg`;
    const storageRef = ref(this.storage, avatarPath);
    const uploadTask = uploadBytesResumable(storageRef, file);

    return new Observable<string>((observer) => {
      uploadTask.on(
        'state_changed',
        (snapshot) => {
          if (progressCallback) {
            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            console.log('[StorageService] Progresso uploadProfileAvatar:', progress);
            progressCallback(progress);
          }
        },
        (error) => {
          const errorMsg = this.extractErrorMessage(error);
          console.log('[StorageService] Erro uploadProfileAvatar:', errorMsg);
          this.errorNotifier.showError('Erro no upload do avatar.');
          observer.error(error);
        },
        async () => {
          try {
            const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
            await this.usuarioService.atualizarUsuario(userId, { photoURL: downloadUrl }).toPromise();
            console.log('[StorageService] Avatar atualizado com sucesso! URL:', downloadUrl);
            this.errorNotifier.showSuccess('Avatar atualizado com sucesso!');
            observer.next(downloadUrl);
            observer.complete();
          } catch (error) {
            const errorMsg = this.extractErrorMessage(error);
            console.log('[StorageService] Erro ao atualizar perfil com a nova foto:', errorMsg);
            this.errorNotifier.showError('Erro ao atualizar o perfil com a nova foto.');
            observer.error(error);
          }
        }
      );
    }).pipe(
      catchError((error) => {
        const errorMsg = this.extractErrorMessage(error);
        console.log('[StorageService] Erro no fluxo do Observable uploadProfileAvatar:', errorMsg);
        return throwError(() => error);
      })
    );
  }

  getPhotoUrl(path: string): Observable<string> {
    console.log('[StorageService] Buscando URL da foto:', path);
    const storageRef = ref(this.storage, path);

    return from(getDownloadURL(storageRef)).pipe(
      map(url => {
        console.log('[StorageService] URL da foto obtida:', url);
        return url;
      }),
      catchError(error => {
        const errorMsg = this.extractErrorMessage(error);
        console.log('[StorageService] Erro ao carregar a foto:', errorMsg);
        this.errorNotifier.showError('Erro ao carregar a foto.');
        return of('');
      })
    );
  }

  replaceFile(file: File, path: string): Observable<string> {
    console.log('[StorageService] Iniciando replaceFile em:', path);
    const storageRef = ref(this.storage, path);

    return from(uploadBytes(storageRef, file)).pipe(
      switchMap(snapshot => from(getDownloadURL(snapshot.ref))),
      map(downloadUrl => {
        console.log('[StorageService] Foto substituída com sucesso! URL:', downloadUrl);
        this.errorNotifier.showSuccess('Foto substituída com sucesso!');
        return downloadUrl;
      }),
      catchError(error => {
        const errorMsg = this.extractErrorMessage(error);
        console.log('[StorageService] Erro ao substituir a foto:', errorMsg);
        this.errorNotifier.showError('Erro ao substituir a foto.');
        return of('');
      })
    );
  }

  deleteFile(path: string): Observable<void> {
    console.log('[StorageService] Iniciando deleteFile em:', path);
    const storageRef = ref(this.storage, path);

    return from(deleteObject(storageRef)).pipe(
      map(() => {
        console.log('[StorageService] Foto deletada com sucesso!');
        this.errorNotifier.showSuccess('Foto deletada com sucesso!');
      }),
      catchError(error => {
        const errorMsg = this.extractErrorMessage(error);
        console.log('[StorageService] Erro ao deletar a foto:', errorMsg);
        this.errorNotifier.showError('Erro ao deletar a foto.');
        return of();
      })
    );
  }
}
