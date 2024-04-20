//src\app\photo\services-photo\photo-metadata.service.ts
import { Injectable } from '@angular/core';
import { getFirestore, collection, addDoc } from 'firebase/firestore';
import { from, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class PhotoMetadataService {
  private db = getFirestore();

  constructor() { }

  addPhotoMetadata(uid: string, metadata: any): Observable<any> {
    return from(addDoc(collection(this.db, `avatares/${uid}/metadados`), metadata));
  }
}
