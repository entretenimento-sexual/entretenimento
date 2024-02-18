//src\app\core\services\photo\photo.service.ts
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
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
          observer.next(progress); // Emitindo o progresso em percentual
        },
        (error) => {
          observer.error(error);
        },
        async () => {
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          // Aqui, salve os metadados no Firestore
          const fotoMetadados = {
            url: downloadURL,
            descricao: descricao,
            timestamp: new Date() // Ou use o timestamp do Firestore para data/hora atual
          };
          addDoc(collection(this.db, `avatares/${uid}/metadados`), fotoMetadados)
            .then(() => {
              observer.next(downloadURL); // Emitindo a URL após o upload ser concluído
              observer.complete();
            })
            .catch((error) => {
              observer.error(error);
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
