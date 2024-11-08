// src/app/core/services/autentication/firestore-query.service.ts
import { Injectable } from '@angular/core';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, doc, getDoc, Query, CollectionReference } from 'firebase/firestore';
import { environment } from 'src/environments/environment';
import { IUserDados } from '../../interfaces/iuser-dados';
import { catchError, from, map, Observable, of } from 'rxjs';

const app = initializeApp(environment.firebase);

@Injectable({
  providedIn: 'root'
})
export class FirestoreQueryService {
  private db = getFirestore(app);

  constructor() { }

  // Método genérico para obter documentos de uma consulta
  private async getDocsFromQuery<T>(q: Query): Promise<T[]> {
    try {
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => doc.data() as T);
    } catch (error) {
      console.error('Erro ao buscar documentos:', error);
      throw error;
    }
  }

  // Método para buscar os dados de um usuário específico
  async getUserData(uid: string): Promise<IUserDados | null> {
    try {
      const userRef = doc(this.db, 'users', uid);
      const userDoc = await getDoc(userRef);

      if (userDoc.exists()) {
        return userDoc.data() as IUserDados;
      } else {
        console.warn('Usuário não encontrado.');
        return null;
      }
    } catch (error) {
      console.error('Erro ao buscar dados do usuário:', error);
      throw error;
    }
  }

  // Obtém todos os usuários
  async getAllUsers(): Promise<IUserDados[]> {
    const usersCollection = collection(this.db, 'users');
    return this.getDocsFromQuery<IUserDados>(query(usersCollection));
  }

  // Obtém todos os usuários online
  async getOnlineUsers(): Promise<IUserDados[]> {
    const usersRef = collection(this.db, 'users');
    const q = query(usersRef, where('isOnline', '==', true));
    return this.getDocsFromQuery<IUserDados>(q);
  }

  // Busca usuários por município
  async getUsersByMunicipio(municipio: string): Promise<IUserDados[]> {
    const usersRef = collection(this.db, 'users');
    const q = query(usersRef, where('municipio', '==', municipio));
    return this.getDocsFromQuery<IUserDados>(q);
  }

  // Busca usuários online por município
  async getOnlineUsersByMunicipio(municipio: string): Promise<IUserDados[]> {
    const onlineUsers = await this.getOnlineUsers();
    return onlineUsers.filter(user => user.municipio === municipio);
  }

  // Obtém usuários online por região
  getOnlineUsersByRegion(municipio: string): Observable<IUserDados[]> {
    const usersRef = collection(this.db, 'users');
    const q = query(usersRef, where('isOnline', '==', true), where('municipio', '==', municipio));
    return from(getDocs(q)).pipe(
      map(snapshot => snapshot.docs.map(doc => doc.data() as IUserDados)),
      catchError(error => {
        console.error('Erro ao buscar usuários online por região:', error);
        return of([]);
      })
    );
  }

  // Busca perfis sugeridos
  async getSuggestedProfiles(): Promise<IUserDados[]> {
    const userCollection = collection(this.db, 'users');
    return this.getDocsFromQuery<IUserDados>(query(userCollection));
  }

  // Busca perfis por orientação, localização e gênero
  async getProfilesByOrientationAndLocation(gender: string, orientation: string, municipio: string): Promise<IUserDados[]> {
    const userCollection = collection(this.db, 'users');
    const q = query(
      userCollection,
      where('gender', '==', gender),
      where('orientation', '==', orientation),
      where('municipio', '==', municipio)
    );
    return this.getDocsFromQuery<IUserDados>(q);
  }
}
