// src/app/core/services/autentication/firestore-query.service.ts
import { Injectable } from '@angular/core';
import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  onSnapshot,
  QueryConstraint,
  QueryDocumentSnapshot,
  DocumentData,
  limit,
  orderBy,
  Query,
  Firestore,
  updateDoc
} from 'firebase/firestore';
import { environment } from 'src/environments/environment';
import { IUserDados } from '../../interfaces/iuser-dados';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { addUserToState, updateUserInState } from 'src/app/store/actions/actions.user/user.actions';
import { selectUserProfileDataByUid } from 'src/app/store/selectors/selectors.user/user-profile.selectors';
import { firstValueFrom, from, map, Observable, of } from 'rxjs';
import { take, tap, shareReplay, catchError } from 'rxjs/operators';

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
  private notFoundCache: Set<string> = new Set();
  private userObservablesCache: Map<string, Observable<IUserDados | null>> = new Map();

  constructor(private store: Store<AppState>) { }

  getFirestoreInstance(): Firestore {
    return this.db;
  }

  private initializeListeners(): void {
    const usersCollection = collection(this.db, 'users');

    // Listener para todos os usuários
    onSnapshot(usersCollection, snapshot => {
      const users = snapshot.docs.map(doc => doc.data() as IUserDados);
      this.allUsersCache = users;

      // Atualizar cache de Observables
      users.forEach(user => {
        this.userObservablesCache.set(user.uid, of(user).pipe(shareReplay(1)));
      });

      console.log('Cache de todos os usuários atualizado pelo listener.');
    });

    // Listener para usuários online
    const onlineUsersQuery = query(usersCollection, where('isOnline', '==', true));
    onSnapshot(onlineUsersQuery, snapshot => {
      const users = snapshot.docs.map(doc => doc.data() as IUserDados);
      this.onlineUsersCache = users;

      // Atualizar cache de Observables para usuários online
      users.forEach(user => {
        this.userObservablesCache.set(user.uid, of(user).pipe(shareReplay(1)));
      });

      console.log('Cache de usuários online atualizado pelo listener.');
    });
  }


  // Ajuste no método getUserWithObservable para verificar melhor o cache de "não encontrados"
  getUserWithObservable(uid: string): Observable<IUserDados | null> {
    const normalizedUid = uid.trim();

    if (this.userCache.has(normalizedUid)) {
      console.log(`Usuário ${normalizedUid} encontrado no cache local.`);
      return of(this.userCache.get(normalizedUid) || null);
    }

    // Verificar se o usuário está no cache de "não encontrados"
    if (this.notFoundCache.has(normalizedUid)) {
      console.log(`Usuário ${normalizedUid} está no cache de não encontrados.`);
      return of(null);
    }

    // Verificar se o Observable já está no cache
    if (this.userObservablesCache.has(normalizedUid)) {
      return this.userObservablesCache.get(normalizedUid)!;
    }

    // Criar um Observable que busca o usuário diretamente do Firestore e compartilha o resultado
    const userObservable = from(this.getUserData(normalizedUid)).pipe(
      tap(userData => {
        if (userData) {
          this.updateUserCache(normalizedUid, userData);
          console.log(`Usuário ${normalizedUid} encontrado e armazenado no cache pelo Observable.`);
        } else {
          console.log(`Usuário ${normalizedUid} não encontrado pelo Observable.`);
          // Somente adicionar ao cache de "não encontrados" se a tentativa de buscar no Firestore falhar
          this.notFoundCache.add(normalizedUid);
          setTimeout(() => this.notFoundCache.delete(normalizedUid), 30000); // Remover após 30s
        }
      }),
      shareReplay(1),  // Compartilha o resultado para evitar múltiplas requisições
      tap({
        error: (error) => {
          console.error(`Erro ao buscar usuário ${normalizedUid}:`, error);
          this.userObservablesCache.delete(normalizedUid); // Remover do cache para evitar armazenar falhas
        }
      })
    );


    // Armazena o Observable em cache
    this.userObservablesCache.set(normalizedUid, userObservable);
    return userObservable;
  }


// Versão aprimorada para retornar Observable
  getUser(uid: string): Observable<IUserDados | null> {
    const normalizedUid = uid.trim();

    // Verificar se o usuário já está no cache
    if (this.userCache.has(normalizedUid)) {
      console.log(`Usuário ${normalizedUid} encontrado no cache.`);
      return of(this.userCache.get(normalizedUid) || null);
    }

    // Verificar se o usuário está marcado como "não encontrado" recentemente
    if (this.notFoundCache.has(normalizedUid)) {
      console.log(`Usuário ${normalizedUid} já está no cache de não encontrados.`);
      return of(null);
    }

    // Buscar no estado (Store)
    return this.store.select(selectUserProfileDataByUid(normalizedUid)).pipe(
      take(1),
      tap(userFromStore => {
        if (userFromStore) {
          this.updateUserCache(normalizedUid, userFromStore); // Atualiza o cache
          console.log(`Usuário ${normalizedUid} encontrado no estado (Store).`);
        }
      }),
      map(userFromStore => {
        if (userFromStore) {
          return userFromStore;
        } else {
          throw new Error('Usuário não encontrado no estado (Store). Buscando no Firestore...');
        }
      }),
      catchError(() => {
        // Buscar no Firestore caso não esteja no estado (Store)
        return from(this.getUserData(normalizedUid)).pipe(
          tap(userFromFirestore => {
            if (userFromFirestore) {
              console.log(`Usuário ${normalizedUid} encontrado no Firestore.`);
              this.store.dispatch(addUserToState({ user: userFromFirestore })); // Atualiza o estado (Store)
              this.updateUserCache(normalizedUid, userFromFirestore); // Atualiza o cache
            } else {
              // Caso o usuário não seja encontrado, adicionar ao cache de não encontrados
              this.notFoundCache.add(normalizedUid);
              setTimeout(() => this.notFoundCache.delete(normalizedUid), 30000); // Remover do cache após 30s
              console.log(`Usuário ${normalizedUid} não encontrado e armazenado no cache de não encontrados por 30 segundos.`);
            }
          }),
          map(userFromFirestore => userFromFirestore || null),
          catchError(error => {
            console.error(`Erro ao buscar usuário no Firestore: ${error}`);
            return of(null);
          })
        );
      })
    );
  }


  /**
   * Atualiza o estado e o cache do usuário fornecido.
   * @param uid - Identificador único do usuário.
   * @param updatedData - Dados atualizados do usuário.
   */
  updateUserInStateAndCache(uid: string, updatedData: IUserDados): void {
    // Atualiza o cache
    this.updateUserCache(uid, updatedData);

    // Atualiza o estado no Store
    this.store.dispatch(updateUserInState({ uid, updatedData }));
    console.log(`Usuário ${uid} atualizado no cache e no estado.`);

    // Atualiza também o cache de Observable para evitar dados obsoletos
    this.userObservablesCache.set(uid, of(updatedData).pipe(shareReplay(1)));
  }

  // Método genérico para buscar um único documento pelo UID no Firestore
  async getDocumentById<T>(user: string, id: string): Promise<T | null> {
    try {
      const docRef = doc(this.db, user, id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return docSnap.data() as T;
      } else {
        console.log(`Nenhum documento encontrado na coleção ${user} para o ID: ${id}`);
        return null;
      }
    } catch (error) {
      console.error(`Erro ao buscar documento na coleção ${user} para o ID: ${id}`, error);
      throw error;
    }
  }

  // Método genérico para buscar vários documentos com base em uma query
  async getDocumentsByQuery<T>(collectionName: string, constraints: QueryConstraint[]): Promise<T[]> {
    try {
      const collectionRef = collection(this.db, collectionName);
      const q = query(collectionRef, ...constraints);
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => doc.data() as T);
    } catch (error) {
      console.error(`Erro ao buscar documentos na coleção ${collectionName}`, error);
      throw error;
    }
  }

  // Método para retornar Observable a partir da busca de um documento
  getDocumentByIdObservable<T>(collectionName: string, id: string): Observable<T | null> {
    return from(this.getDocumentById<T>(collectionName, id));
  }

  // Método genérico para obter documentos de uma consulta
  private async getDocsFromQuery<T>(q: Query<DocumentData>): Promise<T[]> {
    try {
      const snapshot = await getDocs(q);
      return snapshot.docs.map((doc) => doc.data() as T);
    } catch (error) {
      console.error('Erro ao buscar documentos:', error);
      throw error;
    }
  }

  // Método para buscar os dados de um usuário específico
  async getUserData(uid: string): Promise<IUserDados | null> {
    if (this.notFoundCache.has(uid)) {
      console.log(`Usuário ${uid} já está no cache de não encontrados.`);
      return null;
    }

    try {
      const userDoc = await getDoc(doc(this.db, 'users', uid));
      if (userDoc.exists()) {
        const userData = userDoc.data() as IUserDados;
        this.updateUserCache(uid, userData);
        return userData;
      } else {
        this.notFoundCache.add(uid);
        setTimeout(() => this.notFoundCache.delete(uid), 30000); // Limpar após 30s
        console.log(`Usuário ${uid} não encontrado e armazenado no cache de não encontrados por 30 segundos.`);
        return null;
      }
    } catch (error) {
      console.error(`Erro ao buscar dados do usuário ${uid}:`, error);
      throw error;
    }
  }

  // Função que limita o número de tentativas ao buscar um usuário
  getUserWithRetries(uid: string, retries: number = 3): Observable<IUserDados | null> {
    let attempts = 0;
    return new Observable<IUserDados | null>(observer => {
      const attemptFetch = () => {
        this.getUser(uid).pipe(
          take(1),
          catchError(error => {
            console.error(`Erro na tentativa ${attempts + 1} ao buscar usuário:`, error);
            attempts++;
            if (attempts < retries) {
              setTimeout(attemptFetch, 500); // Espera 500ms entre as tentativas
            } else {
              console.error(`Todas as ${retries} tentativas de buscar o usuário falharam.`);
              observer.next(null);
              observer.complete();
            }
            return of(null);
          })
        ).subscribe(user => {
          if (user) {
            observer.next(user);
            observer.complete();
          } else if (attempts >= retries) {
            observer.next(null);
            observer.complete();
          }
        });
      };
      attemptFetch();
    });
  }

  // Função utilitária para delay
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }



  // Atualiza o cache de usuários com opção de log de debug
  private updateUserCache(uid: string, userData: IUserDados): void {
    this.userCache.set(uid, userData);
    console.debug(`Usuário ${uid} adicionado/atualizado no cache.`);
    // Atualiza o estado no Store
    this.store.dispatch(updateUserInState({ uid, updatedData: userData }));
    this.userObservablesCache.set(uid, of(userData).pipe(shareReplay(1)));
    console.log(`Usuário ${uid} atualizado no cache e no estado.`);
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

  async searchUsers(
    constraints: QueryConstraint[],
    limitResults: number = 10
  ): Promise<IUserDados[]> {
    try {
      const q = query(collection(this.db, 'users'), ...constraints);
      const snapshot = await getDocs(q);
      return snapshot.docs.map((doc) => doc.data() as IUserDados);
    } catch (error) {
      console.error('Erro ao buscar usuários:', error);
      throw error;
    }
  }

  // Obtém o usuário do Store pelo UID, se disponível.
  getUserFromState(uid: string): Observable<IUserDados | null> {
    return this.getUserWithObservable(uid);
  }


  // Obtém o usuário pelo UID, primeiro verificando no Store e, se não encontrado, busca no Firestore.
  getUserById(uid: string): Observable<IUserDados | null> {
    console.log(`Método getUserById foi chamado.`);
    return this.getUser(uid);
  }

  // Limpa o cache de usuários (pode ser chamado após uma alteração).
  clearCache(): void {
    this.userCache.clear();
    this.allUsersCache = null;
    this.onlineUsersCache = null;
    this.userObservablesCache.clear();
    console.log('Cache limpo.');
  }
}
