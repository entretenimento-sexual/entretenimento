//src\app\core\services\data-handling\firestore-user-query.service.ts
import { Injectable } from '@angular/core';
import { CacheService } from '../general/cache.service';
import { IUserDados } from '../../interfaces/iuser-dados';
import { doc, getDoc, getFirestore } from '@firebase/firestore';
import { from, Observable, of, shareReplay, switchMap, take, tap, catchError, map } from 'rxjs';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { addUserToState, updateUserInState } from 'src/app/store/actions/actions.user/user.actions';
import { selectUserProfileDataByUid } from 'src/app/store/selectors/selectors.user/user-profile.selectors';
import { initializeApp } from 'firebase/app';
import { environment } from 'src/environments/environment';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';

const app = initializeApp(environment.firebase);

@Injectable({
  providedIn: 'root',
})
export class FirestoreUserQueryService {
  private db = getFirestore(app); // Inicializa Firestore
  private userObservablesCache: Map<string, Observable<IUserDados | null>> = new Map();

  constructor(
    private cacheService: CacheService,
    private store: Store<AppState>,
    private globalErrorHandler: GlobalErrorHandlerService // Para tratar erros globalmente
  ) { }

  getUser(uid: string): Observable<IUserDados | null> {
    const normalizedUid = uid.trim();

    // 1. Verificar no cache
    const cachedUser = this.cacheService.get<IUserDados>(`user:${normalizedUid}`);
    if (cachedUser) {
      console.log(`[FirestoreUserQueryService] Usuário ${normalizedUid} encontrado no cache.`);
      return of(cachedUser);
    }

    // 2. Verificar no Store (Estado)
    return this.store.select(selectUserProfileDataByUid(normalizedUid)).pipe(
      take(1),
      switchMap((userFromStore) => {
        if (userFromStore) {
          console.log(`[FirestoreUserQueryService] Usuário ${normalizedUid} encontrado no estado (Store).`);
          // Atualizar o cache
          this.cacheService.set(`user:${normalizedUid}`, userFromStore, 300000); // Cache com TTL de 5 minutos
          return of(userFromStore);
        }

        // 3. Buscar no Firestore caso não esteja no estado
        console.log(`[FirestoreUserQueryService] Usuário ${normalizedUid} não encontrado no estado. Buscando no Firestore...`);
        const docRef = doc(this.db, 'users', normalizedUid);
        return from(getDoc(docRef)).pipe(
          map((docSnap) => (docSnap.exists() ? (docSnap.data() as IUserDados) : null)),
          tap((userFromFirestore) => {
            if (userFromFirestore) {
              console.log(`[FirestoreUserQueryService] Usuário ${normalizedUid} encontrado no Firestore.`);
              // Atualizar Store e Cache
              this.store.dispatch(addUserToState({ user: userFromFirestore }));
              this.cacheService.set(`user:${normalizedUid}`, userFromFirestore, 300000); // Cache com TTL de 5 minutos
            } else {
              console.log(`[FirestoreUserQueryService] Usuário ${normalizedUid} não encontrado no Firestore.`);
            }
          }),
          catchError((error) => {
            console.error(`[FirestoreUserQueryService] Erro ao buscar usuário no Firestore:`, error);
            this.globalErrorHandler.handleError(error);
            return of(null);
          })
        );
      })
    );
  }


  /**
   * Obtém os dados do usuário diretamente do Firestore.
   * @param uid UID do usuário.
   */
  async getUserData(uid: string): Promise<IUserDados | null> {
    const cachedUser = this.cacheService.get<IUserDados>(`user:${uid}`);
    if (cachedUser) return cachedUser;

    try {
      const userDoc = await getDoc(doc(this.db, 'users', uid));
      if (userDoc.exists()) {
        const userData = userDoc.data() as IUserDados;
        this.cacheService.set(`user:${uid}`, userData, 300000); // TTL de 5 minutos
        return userData;
      }
    } catch (error) {
      console.error(`Erro ao buscar dados do usuário ${uid}:`, error);
      this.globalErrorHandler.handleError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
    return null;
  }

  /**
   * Obtém os dados do usuário, verificando primeiro no cache, depois no estado e, por fim, no Firestore.
   * @param uid UID do usuário.
   */
  getUserById(uid: string): Observable<IUserDados | null> {
    console.log(`Método getUserById foi chamado.`);

    // Verifica no CacheService antes de qualquer operação
    const cachedUser = this.cacheService.get<IUserDados>(`user:${uid}`);
    if (cachedUser) {
      console.log(`[FirestoreUserQueryService] Usuário ${uid} encontrado no cache.`);
      return of(cachedUser);
    }

    // Verifica no Store
    return this.store.select(selectUserProfileDataByUid(uid)).pipe(
      take(1),
      tap(userFromStore => {
        if (userFromStore) {
          this.cacheService.set(`user:${uid}`, userFromStore, 300000); // Armazena no cache por 5 minutos
          console.log(`[FirestoreUserQueryService] Usuário ${uid} encontrado no estado.`);
        }
      }),
      switchMap(userFromStore =>
        userFromStore
          ? of(userFromStore)
          : from(this.getUserData(uid)).pipe(
            tap(userFromFirestore => {
              if (userFromFirestore) {
                this.cacheService.set(`user:${uid}`, userFromFirestore, 300000); // Atualiza o cache
                console.log(`[FirestoreUserQueryService] Usuário ${uid} encontrado no Firestore.`);
              }
            }),
            catchError(error => {
              console.error(`Erro ao buscar usuário no Firestore:`, error);
              this.globalErrorHandler.handleError(error);
              return of(null);
            })
          )
      )
    );
  }

  /**
   * Obtém os dados do usuário como Observable, priorizando o cache.
   * @param uid UID do usuário.
   */
  getUserWithObservable(uid: string): Observable<IUserDados | null> {
    const normalizedUid = uid.trim();

    // Verificar se já está no cache
    if (this.cacheService.has(`user:${normalizedUid}`)) {
      const cachedUser = this.cacheService.get<IUserDados>(`user:${normalizedUid}`);
      console.log(`[FirestoreUserQueryService] Usuário ${normalizedUid} encontrado no cache.`);
      return of(cachedUser);
    }

    // Adicionar ao cache de não encontrados se necessário
    if (this.cacheService.isNotFound(normalizedUid)) {
      console.log(`[FirestoreUserQueryService] Usuário ${normalizedUid} está no cache de não encontrados.`);
      return of(null);
    }

    // Criar Observable para buscar os dados do usuário
    const userObservable = from(this.getUserData(normalizedUid)).pipe(
      tap(userData => {
        if (userData) {
          this.cacheService.set(`user:${normalizedUid}`, userData, 300000); // Adicionar ao cache
          console.log(`[FirestoreUserQueryService] Usuário ${normalizedUid} encontrado e armazenado no cache.`);
        } else {
          console.log(`[FirestoreUserQueryService] Usuário ${normalizedUid} não encontrado.`);
          this.cacheService.markAsNotFound(normalizedUid, 30000); // Adicionar ao cache de não encontrados
        }
      }),
      shareReplay(1), // Evitar múltiplas requisições simultâneas
      catchError(error => {
        console.error(`Erro ao buscar usuário ${normalizedUid}:`, error);
        this.globalErrorHandler.handleError(error);
        return of(null);
      })
    );

    // Armazenar no cache de observables
    this.userObservablesCache.set(normalizedUid, userObservable);
    return userObservable;
  }

  /**
   * Atualiza os dados do usuário no cache e no estado.
   * @param uid UID do usuário.
   * @param updatedData Dados atualizados.
   */
  updateUserInStateAndCache(uid: string, updatedData: IUserDados): void {
    const cachedUser = this.cacheService.get<IUserDados>(`user:${uid}`);
    if (cachedUser && JSON.stringify(cachedUser) === JSON.stringify(updatedData)) {
      console.log(`[FirestoreUserQueryService] Usuário ${uid} já está atualizado no cache e no estado.`);
      return;
    }

    this.cacheService.set(`user:${uid}`, updatedData, 300000); // Atualiza o cache
    this.store.dispatch(updateUserInState({ uid, updatedData })); // Atualiza o estado
    console.log(`[FirestoreUserQueryService] Usuário ${uid} atualizado no cache e no estado.`);
  }
}
