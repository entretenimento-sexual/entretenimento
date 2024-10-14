// src/app/core/services/image-handling/photo-firestore.service.ts
import { Injectable } from '@angular/core';
import { collection, getFirestore, doc, setDoc, deleteDoc, increment, updateDoc, onSnapshot, getDocs } from '@firebase/firestore';
import { Observable } from 'rxjs';
import { ErrorNotificationService } from '../error-handler/error-notification.service';
import { StorageService } from './storage.service';

export interface Photo {
  id: string;
  url: string;
  fileName: string;
  createdAt: Date;
}

@Injectable({
  providedIn: 'root'
})

export class PhotoFirestoreService {
  private db = getFirestore();

  constructor(private errorNotifier: ErrorNotificationService,
              private storageService: StorageService) { }

  // Método para obter todas as fotos de um usuário com reatividade
  getPhotosByUser(userId: string): Observable<any[]> {
    const photosCollection = collection(this.db, `users/${userId}/photos`);
    return new Observable<any[]>(observer => {
      const unsubscribe = onSnapshot(photosCollection, snapshot => {
        const photos = snapshot.docs.map(doc => doc.data());
        observer.next(photos);
      }, error => {
        this.errorNotifier.showError('Erro ao carregar as fotos.');
        observer.error(error);
      });

      return () => unsubscribe();
    });
  }

  // Método para salvar o estado da imagem
  async saveImageState(userId: string, imageStateStr: string): Promise<void> {
    try {
      const imageStateRef = doc(this.db, `users/${userId}/imageStates/${Date.now()}`);
      await setDoc(imageStateRef, { imageState: imageStateStr });
      this.errorNotifier.showSuccess('Estado da imagem salvo com sucesso!');
    } catch (error) {
      this.errorNotifier.showError('Erro ao salvar o estado da imagem.');
      throw error;
    }
  }

  // Método para contar o número de fotos de um usuário
  async countPhotos(userId: string): Promise<number> {
    try {
      const photosCollection = collection(this.db, `users/${userId}/photos`);
      const snapshot = await getDocs(photosCollection);
      return snapshot.size;
    } catch (error) {
      this.errorNotifier.showError('Erro ao contar as fotos.');
      throw error;
    }
  }

  // Método para salvar metadados da foto
  async savePhotoMetadata(userId: string, photo: Photo): Promise<void> {
    try {
      const photoRef = doc(this.db, `users/${userId}/photos/${photo.id}`);
      await setDoc(photoRef, photo);
      this.errorNotifier.showSuccess('Metadados da foto salvos com sucesso!');
    } catch (error) {
      this.errorNotifier.showError('Erro ao salvar os metadados da foto.');
      throw error;
    }
  }

  // Método para atualizar os metadados de uma foto após edição
  async updatePhotoMetadata(userId: string, photoId: string, updatedData: any): Promise<void> {
    try {
      const photoRef = doc(this.db, `users/${userId}/photos/${photoId}`);
      await updateDoc(photoRef, updatedData);
      this.errorNotifier.showSuccess('Metadados atualizados com sucesso!');
    } catch (error) {
      this.errorNotifier.showError('Erro ao atualizar os metadados da foto.');
      throw error;
    }
  }

  // Método para adicionar um comentário à foto
  async addComment(userId: string, photoId: string, comment: string): Promise<void> {
    try {
      const commentsRef = doc(this.db, `users/${userId}/photos/${photoId}/comments/${Date.now()}`);
      await setDoc(commentsRef, { comment, date: new Date() });
    } catch (error) {
      this.errorNotifier.showError('Erro ao adicionar o comentário.');
      throw error;
    }
  }

  // Método para obter os comentários de uma foto com reatividade
  getComments(userId: string, photoId: string): Observable<any[]> {
    const commentsCollection = collection(this.db, `users/${userId}/photos/${photoId}/comments`);
    return new Observable<any[]>(observer => {
      const unsubscribe = onSnapshot(commentsCollection, snapshot => {
        const comments = snapshot.docs.map(doc => doc.data());
        observer.next(comments);
      }, error => {
        this.errorNotifier.showError('Erro ao carregar os comentários.');
        observer.error(error);
      });

      return () => unsubscribe();
    });
  }

  // Método para deletar foto do Firestore e do Storage
  async deletePhoto(userId: string, photoId: string, photoPath: string): Promise<void> {
    try {
      // Primeiro, remover a foto do Storage
      await this.storageService.deleteFile(photoPath).toPromise();

      // Após a remoção do arquivo, remover os metadados do Firestore
      const photoRef = doc(this.db, `users/${userId}/photos/${photoId}`);
      await deleteDoc(photoRef);

      this.errorNotifier.showSuccess('Foto e metadados deletados com sucesso!');
    } catch (error) {
      this.errorNotifier.showError('Erro ao deletar a foto ou metadados.');
      throw error;
    }
  }
}
