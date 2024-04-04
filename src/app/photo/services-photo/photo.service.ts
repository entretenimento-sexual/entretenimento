//src\app\photo\services-photo\photo.service.ts
import { Injectable } from '@angular/core';
import { Observable, catchError, from, map, of, switchMap } from 'rxjs';
import { getStorage, ref, uploadBytesResumable, getDownloadURL, listAll } from 'firebase/storage';
import { getFirestore, collection, addDoc } from 'firebase/firestore';
import { environment } from 'src/environments/environment';
import { initializeApp } from 'firebase/app';

@Injectable({
  providedIn: 'root'
})

export class PhotoService {
  private db = getFirestore();

  constructor() { initializeApp(environment.firebaseConfig); }

  uploadFoto(foto: File, filePath: string, descricao: string, uid: string): Observable<number | string> {
    const storage = getStorage();
    const storageRef = ref(storage, filePath);
    const uploadTask = uploadBytesResumable(storageRef, foto);

    return new Observable(observer => {
      uploadTask.on('state_changed',
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          observer.next(progress); // Emitindo o progresso
        },
        (error) => observer.error(error),
        () => {
          from(getDownloadURL(uploadTask.snapshot.ref)).pipe(
            switchMap(downloadURL => {
              const fotoMetadados = {
                url: downloadURL,
                descricao: descricao,
                timestamp: new Date()
              };
              return from(addDoc(collection(this.db, `avatares/${uid}/metadados`), fotoMetadados)).pipe(
                switchMap(() => of(downloadURL)) // Retorna a URL após adicionar metadados
              );
            }),
            catchError(error => {
              observer.error(error);
              return of('Erro ao fazer upload da imagem.');
            })
          ).subscribe({
            next: (result) => observer.next(result),
            error: (error) => observer.error(error),
            complete: () => observer.complete()
          });
        }
      );
    });
  }



  getFotosDoUsuario(uid: string): Observable<any[]> {
    const storage = getStorage();
    const userFolderRef = ref(storage, `avatares/${uid}/galeria/`);

    return new Observable(observer => {
      listAll(userFolderRef)
        .then(async result => {
          const urlPromises = result.items.map(itemRef => getDownloadURL(itemRef));
          const urls = await Promise.all(urlPromises);
          observer.next(urls);
          observer.complete();
        })
        .catch(error => {
          observer.error(error);
        });
    });
  }

    borrarRosto(foto: File): Observable<File> {
    // Implementação simulada, você precisará substituir por uma lógica real
    // que possivelmente envolve o processamento da imagem no lado do servidor
    // e então retorna o arquivo processado
    return of(foto); // Retorna o arquivo original como um placeholder
  }
}
