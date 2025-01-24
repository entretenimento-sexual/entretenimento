// src/app/core/services/autentication/firestore-query.service.ts
import { Injectable } from '@angular/core';
import { where, QueryConstraint, collection, onSnapshot, query, Firestore } from 'firebase/firestore';
import { IUserDados } from '../../interfaces/iuser-dados';
import { CacheService } from '../general/cache.service';
import { FirestoreService } from './firestore.service';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { FirestoreUserQueryService } from './firestore-user-query.service';

@Injectable({
  providedIn: 'root',
})

export class FirestoreQueryService {

  constructor(private firestoreService: FirestoreService,
              private cacheService: CacheService,
              private firestoreUserQuery: FirestoreUserQueryService) { }

  getFirestoreInstance(): Firestore {
    return this.firestoreService.getFirestoreInstance();
  }


  /**
   * Busca um único documento pelo UID no Firestore com suporte a cache.
   */
  getDocumentById<T>(collectionName: string, id: string): Observable<T | null> {
    return this.firestoreService.getDocument<T>(collectionName, id);
  }

  /**
   * Busca documentos com base em uma query (como Observable).
   */
  getDocumentsByQuery<T>(collectionName: string, constraints: QueryConstraint[]): Observable<T[]> {
    return this.firestoreService.getDocuments<T>(collectionName, constraints);
  }

  /**
   * Obtém todos os usuários com cache.
   */
  getAllUsers(): Observable<IUserDados[]> {
    const cacheKey = 'allUsers';
    const cachedUsers = this.cacheService.get<IUserDados[]>(cacheKey);

    if (cachedUsers) {
      console.log('[FirestoreQueryService] Usuários carregados do cache.');
      return of(cachedUsers);
    }

    return this.getDocumentsByQuery<IUserDados>('users', []).pipe(
      map((users) => {
        this.cacheService.set(cacheKey, users, 600000); // TTL de 10 minutos
        return users;
      }),
      catchError(() => of([]))
    );
  }

  /**
   * Obtém todos os usuários online com cache.
   */
  getOnlineUsers(): Observable<IUserDados[]> {
    const cacheKey = 'onlineUsers';
    const cachedUsers = this.cacheService.get<IUserDados[]>(cacheKey);

    if (cachedUsers) {
      console.log('[FirestoreQueryService] Usuários online carregados do cache.');
      return of(cachedUsers);
    }

    return this.getDocumentsByQuery<IUserDados>('users', [where('isOnline', '==', true)]).pipe(
      map((users) => {
        this.cacheService.set(cacheKey, users, 60000); // TTL de 1 minuto
        return users;
      }),
      catchError(() => of([]))
    );
  }

  /**
   * Busca usuários por município.
   */
  getUsersByMunicipio(municipio: string): Observable<IUserDados[]> {
    return this.getDocumentsByQuery<IUserDados>('users', [where('municipio', '==', municipio)]);
  }

  /**
   * Busca usuários online por município.
   */
  getOnlineUsersByMunicipio(municipio: string): Observable<IUserDados[]> {
    return this.getOnlineUsers().pipe(
      map((users) => users.filter((user) => user.municipio === municipio))
    );
  }

  // Obtém usuários online por região
  getOnlineUsersByRegion(municipio: string): Observable<IUserDados[]> {
    const db = this.firestoreService.getFirestoreInstance();
    const usersRef = collection(db, 'users');
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

  /**
   * Busca perfis sugeridos.
   */
  getSuggestedProfiles(): Observable<IUserDados[]> {
    return this.getDocumentsByQuery<IUserDados>('users', []);
  }

  /**
   * Busca perfis por orientação, localização e gênero.
   */
  getProfilesByOrientationAndLocation(
    gender: string,
    orientation: string,
    municipio: string
  ): Observable<IUserDados[]> {
    return this.getDocumentsByQuery<IUserDados>('users', [
      where('gender', '==', gender),
      where('orientation', '==', orientation),
      where('municipio', '==', municipio),
    ]);
  }

  // Obtém o usuário do Store pelo UID, se disponível.
  getUserFromState(uid: string): Observable<IUserDados | null> {
    return this.firestoreUserQuery.getUserWithObservable(uid);
  }

   /**
   * Busca usuários usando uma query customizada.
   */
  searchUsers(constraints: QueryConstraint[]): Observable<IUserDados[]> {
    return this.getDocumentsByQuery<IUserDados>('users', constraints);
  }
}
