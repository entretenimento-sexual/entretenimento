// src/app/core/services/autentication/firestore-query.service.ts
import { Injectable } from '@angular/core';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, doc, getDoc, Query, onSnapshot } from 'firebase/firestore';
import { environment } from 'src/environments/environment';
import { IUserDados } from '../../interfaces/iuser-dados';
import { map, Observable, of } from 'rxjs';

const app = initializeApp(environment.firebase);

@Injectable({
  providedIn: 'root'
})
export class FirestoreQueryService {
  private db = getFirestore(app);

  // Cache simples para armazenar dados já consultados
  private userCache: Map<string, IUserDados> = new Map();
  private allUsersCache: IUserDados[] | null = null;
  private onlineUsersCache: IUserDados[] | null = null;

  constructor() { }

  /**
   * Obtém os dados de um usuário específico com cache.
   * @param uid - Identificador único do usuário.
   */

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
    // Verifica se o usuário já está no cache
    if (this.userCache.has(uid)) {
      console.log(`Usuário ${uid} carregado do cache.`);
      return this.userCache.get(uid) || null;
    }

    try {
      const userRef = doc(this.db, 'users', uid);
      const userDoc = await getDoc(userRef);

      if (userDoc.exists()) {
        const userData = userDoc.data() as IUserDados;
        this.userCache.set(uid, userData); // Adiciona ao cache
        console.log(`Usuário ${uid} adicionado ao cache.`);
        return userData;
      } else {
        console.warn('Usuário não encontrado.');
        return null;
      }
    } catch (error) {
      console.error('Erro ao buscar dados do usuário:', error);
      throw error;
    }
  }

  // Obtém todos os usuários com cache
  getAllUsers(): Observable<IUserDados[]> {
    if (this.allUsersCache) {
      console.log('Todos os usuários carregados do cache.');
      return of(this.allUsersCache);
    }

    const usersCollection = collection(this.db, 'users');
    return new Observable<IUserDados[]>(observer => {
      const unsubscribe = onSnapshot(usersCollection, snapshot => {
        const users = snapshot.docs.map(doc => doc.data() as IUserDados);
        this.allUsersCache = users; // Atualiza o cache
        console.log('Cache de todos os usuários atualizado.');
        observer.next(users);
      }, error => {
        observer.error(error);
      });

      return () => unsubscribe();
    });
  }


  // Obtém todos os usuários online com cache
  getOnlineUsers(): Observable<IUserDados[]> {
    if (this.onlineUsersCache) {
      console.log('Usuários online carregados do cache.');
      return of(this.onlineUsersCache);
    }

    const usersRef = collection(this.db, 'users');
    const q = query(usersRef, where('isOnline', '==', true));

    return new Observable<IUserDados[]>(observer => {
      const unsubscribe = onSnapshot(q, snapshot => {
        const users = snapshot.docs.map(doc => doc.data() as IUserDados);
        this.onlineUsersCache = users; // Atualiza o cache
        console.log('Cache de usuários online atualizado.');
        observer.next(users);
      }, error => {
        observer.error(error);
      });

      return () => unsubscribe();
    });
  }

  // Busca usuários por município
  async getUsersByMunicipio(municipio: string): Promise<IUserDados[]> {
    const usersRef = collection(this.db, 'users');
    const q = query(usersRef, where('municipio', '==', municipio));
    return this.getDocsFromQuery<IUserDados>(q);
  }

  // Busca usuários online por município
  getOnlineUsersByMunicipio(municipio: string): Observable<IUserDados[]> {
    return this.getOnlineUsers().pipe(
      map(users => users.filter(user => user.municipio === municipio))
    );
  }

  // Obtém usuários online por região
  getOnlineUsersByRegion(municipio: string): Observable<IUserDados[]> {
    const usersRef = collection(this.db, 'users');
    const q = query(usersRef, where('isOnline', '==', true), where('municipio', '==', municipio));
    return new Observable<IUserDados[]>(observer => {
      const unsubscribe = onSnapshot(q, snapshot => {
        const users = snapshot.docs.map(doc => doc.data() as IUserDados);
        observer.next(users);
      }, error => {
        observer.error(error);
      });

      return () => unsubscribe();
    });
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

  //Limpa o cache de usuários(pode ser chamado após uma alteração).
  clearCache(): void {
    this.userCache.clear();
    this.allUsersCache = null;
    this.onlineUsersCache = null;
    console.log('Cache limpo.');
  }
}
