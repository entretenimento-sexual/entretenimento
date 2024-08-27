// src/app/core/services/storage.service.ts
import { Injectable } from '@angular/core';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { initializeApp } from 'firebase/app';
import { environment } from 'src/environments/environment';

const app = initializeApp(environment.firebase);

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private storage = getStorage(app);

  async uploadFile(file: File, path: string): Promise<string> {
    const storageRef = ref(this.storage, path);
    const snapshot = await uploadBytes(storageRef, file);
    return getDownloadURL(snapshot.ref);
  }

  async deleteFile(path: string): Promise<void> {
    const storageRef = ref(this.storage, path);
    await deleteObject(storageRef);
  }
}
