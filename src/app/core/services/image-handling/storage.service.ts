// src/app/core/services/storage.service.ts
import { Injectable, Injector } from '@angular/core';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { initializeApp } from 'firebase/app';
import { environment } from 'src/environments/environment';
import { getFirestore, doc, setDoc, deleteDoc, increment, updateDoc } from 'firebase/firestore';

const app = initializeApp(environment.firebase);

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private storage = getStorage(app);
  private db = getFirestore(app);  // Firestore direto no StorageService

  constructor(private injector: Injector) { }

  // Método para upload de arquivo e salvar no Firestore
  async uploadFile(file: File, path: string, userId: string): Promise<string> {
    const storageRef = ref(this.storage, path);
    const snapshot = await uploadBytes(storageRef, file);
    const downloadUrl = await getDownloadURL(snapshot.ref);

    // Salva a URL e metadados no Firestore (adicionando um novo documento em uma subcoleção de fotos)
    const photoRef = doc(this.db, `users/${userId}/photos/${Date.now()}`);
    const photoData = {
      url: downloadUrl,
      path: path,
      uploadDate: new Date(),
      likes: 0,
      dislikes: 0,  // Incluindo campo de dislikes
      reports: 0,    // Incluindo campo de denúncias (reports)
      commentsCount: 0
    };

    await setDoc(photoRef, photoData);
    console.log(`Foto adicionada com sucesso para o usuário ${userId}`);

    return downloadUrl;
  }

  // Método para deletar arquivo do Storage e atualizar no Firestore
  async deleteFile(path: string, userId: string, photoId: string): Promise<void> {
    const storageRef = ref(this.storage, path);
    await deleteObject(storageRef);

    // Remove a referência à foto do Firestore
    const photoRef = doc(this.db, `users/${userId}/photos/${photoId}`);
    await deleteDoc(photoRef);
    console.log(`Foto ${photoId} removida com sucesso para o usuário ${userId}`);
  }

  // Método para buscar a URL da foto de perfil do usuário com base no ID
  async getUserProfilePhotoUrl(userId: string): Promise<string> {
    const filePath = `user_profiles/${userId}/profile_photo.jpg`;  // Caminho da foto de perfil no Firebase
    const storageRef = ref(this.storage, filePath);

    try {
      return await getDownloadURL(storageRef);
    } catch (error) {
      console.error('Erro ao buscar URL da foto de perfil:', error);
      throw error;  // Retorna o erro para ser tratado no componente
    }
  }

  // Método para moderar uma foto (like, dislike, report)
  async moderatePhoto(userId: string, photoId: string, action: 'like' | 'dislike' | 'report'): Promise<void> {
    const photoRef = doc(this.db, `users/${userId}/photos/${photoId}`);
    let updateData: any;

    if (action === 'like') {
      updateData = { likes: increment(1) };
    } else if (action === 'dislike') {
      updateData = { dislikes: increment(1) };
    } else if (action === 'report') {
      updateData = { reports: increment(1) };  // Adicionando uma denúncia
    }

    await updateDoc(photoRef, updateData);
    console.log(`Ação ${action} realizada com sucesso na foto ${photoId} do usuário ${userId}`);
  }
}
