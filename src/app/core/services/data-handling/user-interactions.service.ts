//src\app\core\services\data-handling\user-interactions.service.ts
import { Injectable } from '@angular/core';
import { IUserDados } from '../../interfaces/iuser-dados';
import { FirestoreService } from './firestore.service';
import { CacheService } from '../general/cache/cache.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { collection, query, where, getDocs, setDoc, doc, deleteDoc, Firestore } from 'firebase/firestore';
import { Observable, from, of, switchMap, catchError, map, forkJoin } from 'rxjs';
import { loadRequestsSuccess, loadBlockedSuccess } from 'src/app/store/actions/actions.interactions/actions.friends';
import { FirestoreUserQueryService } from './firestore-user-query.service';

@Injectable({
  providedIn: 'root'
})
export class UserInteractionsService {
  private db: Firestore;

  constructor(
    private firestoreService: FirestoreService,
    private cacheService: CacheService,
    private firestoreUserQuery: FirestoreUserQueryService,
    private store: Store<AppState>,
    private globalErrorHandler: GlobalErrorHandlerService
  ) {
    this.db = this.firestoreService.getFirestoreInstance();
  }

  /**
   * Obtém amigos do usuário autenticado, utilizando cache.
   */
  listFriends(uid: string): Observable<IUserDados[]> {
    if (!uid) return of([]);

    const cacheKey = `friends:${uid}`;

    return this.cacheService.get<IUserDados[]>(cacheKey).pipe(
      switchMap(cachedFriends => cachedFriends ? of(cachedFriends) : this.fetchFriendsFromFirestore(uid))
    );
  }

  /**
  * Busca amigos diretamente do Firestore.
  */
  private fetchFriendsFromFirestore(uid: string): Observable<IUserDados[]> {
    const friendsQuery = query(collection(this.db, 'amigos'), where('uid1', '==', uid));

    return from(getDocs(friendsQuery)).pipe(
      switchMap(querySnapshot => {
        const friendUids = querySnapshot.docs.map(docSnapshot => docSnapshot.data()['uid2']);

        if (!friendUids.length) return of([]); // 🔹 Retorna array vazio se não houver amigos

        // 🔹 `forkJoin` para esperar todas as requisições
        return forkJoin(friendUids.map(friendUid => this.firestoreUserQuery.getUser(friendUid)));
      }),
      map(friends => friends.filter((friend): friend is IUserDados => friend !== null)), // 🔥 Remove `null`
      switchMap(friends => {
        this.cacheService.set(`friends:${uid}`, friends, 300000);
        return of(friends);
      }),
      catchError(error => {
        this.globalErrorHandler.handleError(error);
        return of([]);
      })
    );
  }

  /**
   * Envia uma solicitação de amizade.
   */
  sendFriendRequest(uid: string, friendUid: string): Observable<void> {
    if (!uid || !friendUid) return of(void 0);

    const requestDoc = doc(this.db, `amigos_pedidos/${uid}_${friendUid}`);

    return from(setDoc(requestDoc, { uid1: uid, uid2: friendUid, timestamp: new Date() })).pipe(
      catchError(error => {
        this.globalErrorHandler.handleError(error);
        return of(void 0);
      })
    );
  }

  /**
   * Aceita uma solicitação de amizade.
   */
  acceptFriendRequest(uid: string, friendUid: string): Observable<void> {
    if (!uid || !friendUid) return of(void 0);

    const requestDoc = doc(this.db, `amigos_pedidos/${uid}_${friendUid}`);
    const friendsDoc = doc(this.db, `amigos/${uid}_${friendUid}`);

    return from(deleteDoc(requestDoc)).pipe(
      switchMap(() => setDoc(friendsDoc, { uid1: uid, uid2: friendUid, since: new Date() })),
      switchMap(() => {
        this.cacheService.delete(`friends:${uid}`);
        return of(void 0);
      }),
      catchError(error => {
        this.globalErrorHandler.handleError(error);
        return of(void 0);
      })
    );
  }

  /**
   * Recusa uma solicitação de amizade.
   */
  rejectFriendRequest(uid: string, friendUid: string): Observable<void> {
    if (!uid || !friendUid) return of(void 0);

    const requestDoc = doc(this.db, `amigos_pedidos/${uid}_${friendUid}`);

    return from(deleteDoc(requestDoc)).pipe(
      switchMap(() => {
        this.cacheService.delete(`friend_requests:${friendUid}`);
        return of(void 0);
      }),
      catchError(error => {
        this.globalErrorHandler.handleError(error);
        return of(void 0);
      })
    );
  }

  /**
   * Bloqueia um usuário.
   */
  blockUser(uid: string, friendUid: string): Observable<void> {
    if (!uid || !friendUid) return of(void 0);

    const friendsDoc = doc(this.db, `amigos/${uid}_${friendUid}`);
    const blockedDoc = doc(this.db, `amigos_bloqueados/${uid}_${friendUid}`);

    return from(deleteDoc(friendsDoc)).pipe(
      switchMap(() => setDoc(blockedDoc, { uid1: uid, uid2: friendUid, blocked_at: new Date() })),
      switchMap(() => {
        this.cacheService.delete(`friends:${uid}`);
        return of(void 0);
      }),
      catchError(error => {
        this.globalErrorHandler.handleError(error);
        return of(void 0);
      })
    );
  }

  /**
   * Obtém solicitações de amizade pendentes.
   */
  loadFriendRequests(uid: string): void {
    if (!uid) return;

    const requestsQuery = query(collection(this.db, 'amigos_pedidos'), where('uid2', '==', uid));

    from(getDocs(requestsQuery)).pipe(
      map(querySnapshot => querySnapshot.docs.map(doc => doc.data() as IUserDados)),
      catchError(error => {
        this.globalErrorHandler.handleError(error);
        return of([]);
      })
    ).subscribe(requests => this.store.dispatch(loadRequestsSuccess({ requests })));
  }

  /**
   * Obtém lista de usuários bloqueados.
   */
  loadBlockedUsers(uid: string): void {
    if (!uid) return;

    const blockedQuery = query(collection(this.db, 'amigos_bloqueados'), where('uid1', '==', uid));

    from(getDocs(blockedQuery)).pipe(
      map(querySnapshot => querySnapshot.docs.map(doc => doc.data() as IUserDados)),
      catchError(error => {
        this.globalErrorHandler.handleError(error);
        return of([]);
      })
    ).subscribe(blocked => this.store.dispatch(loadBlockedSuccess({ blocked })));
  }

  //Busca usuários pelo nickname ou UID no Firestore.
  findUsersBySearchTerm(searchTerm: string): Observable<IUserDados[]> {
    const usersQuery = query(collection(this.db, 'users'), where('nickname', '>=', searchTerm));

    return from(getDocs(usersQuery)).pipe(
      map(querySnapshot => querySnapshot.docs.map(doc => doc.data() as IUserDados)),
      catchError(error => {
        this.globalErrorHandler.handleError(error);
        return of([]);
      })
    );
  }

}
