// src/app/core/services/image-handling/photo-firestore.service.ts
import { Injectable } from '@angular/core';
import { collection, getFirestore, doc, setDoc, deleteDoc, query, increment, updateDoc, onSnapshot, getDocs } from '@firebase/firestore';
import { getStorage, ref, deleteObject } from 'firebase/storage'; // Importações necessárias para Firebase Storage
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class PhotoFirestoreService {
  private db = getFirestore();
  private storage = getStorage(); // Instancia o Firebase Storage

  constructor() { }

  // Método para obter todas as fotos de um usuário com reatividade
  getPhotosByUser(userId: string): Observable<any[]> {
    const photosCollection = collection(this.db, `users/${userId}/photos`);
    return new Observable<any[]>(observer => {
      const unsubscribe = onSnapshot(photosCollection, snapshot => {
        const photos = snapshot.docs.map(doc => doc.data());
        observer.next(photos);
      }, error => {
        observer.error(error);
      });

      // Cleanup listener ao finalizar a escuta
      return () => unsubscribe();
    });
  }

  // Método para contar o número de fotos de um usuário
  async countPhotos(userId: string): Promise<number> {
    const photosCollection = collection(this.db, `users/${userId}/photos`);
    const snapshot = await getDocs(photosCollection);
    return snapshot.size;
  }

  // Método para moderar uma foto (like, dislike, report)
  async moderatePhoto(userId: string, photoId: string, action: 'like' | 'dislike' | 'report'): Promise<void> {
    const photoRef = doc(this.db, `users/${userId}/photos/${photoId}`);
    const updateData = action === 'like' ? { likes: increment(1) } :
      action === 'dislike' ? { dislikes: increment(1) } : { reports: increment(1) };

    await updateDoc(photoRef, updateData);
  }

  // Método para adicionar um comentário à foto
  async addComment(userId: string, photoId: string, comment: string): Promise<void> {
    const commentsRef = doc(this.db, `users/${userId}/photos/${photoId}/comments/${Date.now()}`);
    await setDoc(commentsRef, { comment, date: new Date() });
  }

  // Método para obter os comentários de uma foto com reatividade
  getComments(userId: string, photoId: string): Observable<any[]> {
    const commentsCollection = collection(this.db, `users/${userId}/photos/${photoId}/comments`);
    return new Observable<any[]>(observer => {
      const unsubscribe = onSnapshot(commentsCollection, snapshot => {
        const comments = snapshot.docs.map(doc => doc.data());
        observer.next(comments);
      }, error => {
        observer.error(error);
      });

      // Cleanup listener ao finalizar a escuta
      return () => unsubscribe();
    });
  }

  // Método para salvar o estado da edição da imagem
  async saveImageState(userId: string, imageStateStr: string): Promise<void> {
    const imageStateRef = doc(this.db, `users/${userId}/imageStates/${Date.now()}`);
    await setDoc(imageStateRef, { imageState: imageStateStr });
  }

  // Method to delete a photo
  async deletePhoto(userId: string, photoId: string, photoPath: string): Promise<void> {
    try {
      // Remove photo from Firestore
      const photoRef = doc(this.db, `users/${userId}/photos/${photoId}`);
      await deleteDoc(photoRef);

      // Remove photo from Firebase Storage
      const storageRef = ref(this.storage, photoPath);
      await deleteObject(storageRef);

      console.log(`Photo ${photoId} for user ${userId} removed successfully.`);
    } catch (error) {
      console.error('Error removing photo:', error);
      throw error;
    }
  }
}
