// src\app\core\services\firebase.storage\ImageUploadService.ts
import { Injectable } from '@angular/core';
import { AngularFireStorage, AngularFireUploadTask } from '@angular/fire/compat/storage';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { Observable, of, from } from 'rxjs';
import { switchMap, catchError, map } from 'rxjs/operators';
import { AuthService } from '../autentication/auth.service';


@Injectable({
  providedIn: 'root'
})
export class ImageUploadService {

  constructor(
    private storage: AngularFireStorage,
    private afAuth: AngularFireAuth,
    private authService: AuthService
  ) { }

  /**
  * Verifica se o usuário está autenticado.
  * @returns Um Observable que emite true se o usuário estiver autenticado e false caso contrário.
  */
  isAuthenticated(): Observable<boolean> {
    return this.afAuth.authState.pipe(
      switchMap(user => {
        if (user) {
          return of(true);
        } else {
          return of(false);
        }
      }),
      catchError(() => of(false))
    );
  }

  /**
   * [OPCIONAL] Obtém o nível de acesso do usuário.
   * Implemente conforme a lógica do seu sistema, por exemplo, consultando o Firestore.
   */
  getUserAccessLevel(): Observable<'xereta' | 'animando' | 'decidido' | 'articulador' | 'extase' | null> {
    return from(this.authService.getUserProfile()).pipe(
      map(role => {
        if (role === 'xereta' || role === 'animando' || role === 'decidido' || role === 'articulador' || role === 'extase' || role === null) {
          return role;
        }
        throw new Error('Role inválido');
      })
    );
  }

  /**
   * Faz o upload de uma imagem para o Firebase Storage.
   * @param image - O arquivo de imagem a ser carregado.
   * @returns Uma tarefa de upload, que pode ser usada para monitorar o progresso.
   */
  uploadImage(image: File): Observable<AngularFireUploadTask | null> {
    return this.isAuthenticated().pipe(
      switchMap(isAuthenticated => {
        if (isAuthenticated) {
          return this.getUserAccessLevel().pipe(
            switchMap(userRole => {
              if (userRole !== 'xereta') {
                const filePath = `userProfileImages/${Date.now()}_${image.name}`;
                const ref = this.storage.ref(filePath);
                return of(ref.put(image));
              } else {
                console.error('Usuário sem permissão para fazer upload!');
                return of(null);
              }
            })
          );
        } else {
          console.error('Usuário não autenticado!');
          return of(null);
        }
      })
    );
  }

  /**
   * Obtém a URL de download de uma imagem.
   * @param filePath - O caminho da imagem no Firebase Storage.
   * @returns Um Observable que emite a URL de download.
   */
  getImageURL(filePath: string): Observable<string> {
    const ref = this.storage.ref(filePath);
    return ref.getDownloadURL();
  }

  /**
   * Atualiza uma imagem existente. Isso basicamente exclui a imagem anterior e carrega uma nova.
   * @param filePath - O caminho da imagem existente que você deseja substituir.
   * @param newImage - O novo arquivo de imagem a ser carregado.
   * @returns Uma tarefa de upload para a nova imagem.
   */
  
  /**
   * Exclui uma imagem do Firebase Storage.
   * @param filePath - O caminho da imagem que você deseja excluir.
   */
  deleteImage(filePath: string): void {
    const ref = this.storage.ref(filePath);
    ref.delete().subscribe();
  }
}
