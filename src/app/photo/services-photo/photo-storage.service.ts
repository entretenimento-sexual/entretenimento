//src\app\photo\services-photo\photo-storage.service.ts
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';

@Injectable({
  providedIn: 'root'
})
export class PhotoStorageService {
  private storage = getStorage();

  constructor() { }

  uploadFoto(filePath: string, foto: File): Observable<number | string> {
    const storageRef = ref(this.storage, filePath);
    const uploadTask = uploadBytesResumable(storageRef, foto);

    return new Observable(observer => {
      uploadTask.on('state_changed',
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          observer.next(progress);
        },
        (error) => observer.error(error),
        () => {
          getDownloadURL(uploadTask.snapshot.ref).then(downloadURL => {
            observer.next(downloadURL);
            observer.complete();
          });
        }
      );
    });
  }
}
