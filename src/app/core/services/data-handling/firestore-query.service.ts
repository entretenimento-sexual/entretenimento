// src/app/core/services/autentication/firestore-query.service.ts
import { Injectable } from '@angular/core';
import { where, QueryConstraint, collection, onSnapshot, query, Firestore } from '@angular/fire/firestore'; // 👈 AngularFire
import { IUserDados } from '../../interfaces/iuser-dados';
import { CacheService } from '../general/cache/cache.service';
import { FirestoreService } from './firestore.service';
import { Observable, of } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';
import { FirestoreUserQueryService } from './firestore-user-query.service';

@Injectable({
  providedIn: 'root',
})
export class FirestoreQueryService {

  constructor(
    private firestoreService: FirestoreService,
    private cacheService: CacheService,
    private firestoreUserQuery: FirestoreUserQueryService
  ) { }

  getFirestoreInstance(): Firestore {
    return this.firestoreService.getFirestoreInstance();
  }

  getDocumentById<T>(collectionName: string, id: string): Observable<T | null> {
    return this.firestoreService.getDocument<T>(collectionName, id);
  }

  getDocumentsByQuery<T>(collectionName: string, constraints: QueryConstraint[]): Observable<T[]> {
    return this.firestoreService.getDocuments<T>(collectionName, constraints);
  }

  getAllUsers(): Observable<IUserDados[]> {
    const cacheKey = 'allUsers';
    return this.cacheService.get<IUserDados[]>(cacheKey).pipe(
      switchMap(cachedUsers => {
        if (cachedUsers) return of(cachedUsers);
        return this.getDocumentsByQuery<IUserDados>('users', []).pipe(
          map(users => {
            this.cacheService.set(cacheKey, users, 600000);
            return users;
          }),
          catchError(error => {
            console.log('[FirestoreQueryService] Erro ao buscar todos os usuários:', error);
            return of([]);
          })
        );
      })
    );
  }

  getOnlineUsers(): Observable<IUserDados[]> {
    const cacheKey = 'onlineUsers';
    return this.cacheService.get<IUserDados[]>(cacheKey).pipe(
      switchMap(cachedUsers => {
        if (cachedUsers) return of(cachedUsers);
        return this.getDocumentsByQuery<IUserDados>('users', [where('isOnline', '==', true)]).pipe(
          map(users => {
            this.cacheService.set(cacheKey, users, 60000);
            return users;
          }),
          catchError(error => {
            console.log('[FirestoreQueryService] Erro ao buscar usuários online:', error);
            return of([]);
          })
        );
      })
    );
  }

  getUsersByMunicipio(municipio: string): Observable<IUserDados[]> {
    return this.getDocumentsByQuery<IUserDados>('users', [where('municipio', '==', municipio)]);
  }

  getOnlineUsersByMunicipio(municipio: string): Observable<IUserDados[]> {
    return this.getOnlineUsers().pipe(
      map((users) => users.filter((user) => user.municipio === municipio))
    );
  }

  getOnlineUsersByRegion(municipio: string): Observable<IUserDados[]> {
    const db = this.firestoreService.getFirestoreInstance();
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('isOnline', '==', true), where('municipio', '==', municipio));
    return new Observable<IUserDados[]>(observer => {
      const unsubscribe = onSnapshot(q, snapshot => {
        const users = snapshot.docs.map(doc => doc.data() as IUserDados);
        observer.next(users);
      }, error => observer.error(error));
      return () => unsubscribe();
    });
  }

  getSuggestedProfiles(): Observable<IUserDados[]> {
    return this.getDocumentsByQuery<IUserDados>('users', []);
  }

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

  getUserFromState(uid: string): Observable<IUserDados | null> {
    return this.firestoreUserQuery.getUserWithObservable(uid);
  }

  searchUsers(constraints: QueryConstraint[]): Observable<IUserDados[]> {
    return this.getDocumentsByQuery<IUserDados>('users', constraints);
  }
}
