//src\app\core\services\data-handling\firestore-user-query.service.ts
import { Injectable } from '@angular/core';
import { CacheService } from '../general/cache/cache.service';
import { IUserDados } from '../../interfaces/iuser-dados';
import { doc, getDoc, getFirestore } from '@firebase/firestore';
import { from, Observable, of, shareReplay, switchMap, take, tap, catchError, map, firstValueFrom } from 'rxjs';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { addUserToState, updateUserInState } from 'src/app/store/actions/actions.user/user.actions';
import { selectUserProfileDataByUid } from 'src/app/store/selectors/selectors.user/user-profile.selectors';
import { initializeApp } from 'firebase/app';
import { environment } from 'src/environments/environment';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { IUserRegistrationData } from '../../interfaces/iuser-registration-data';
import { FirestoreErrorHandlerService } from '../error-handler/firestore-error-handler.service';

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
    private firestoreErrorHandler: FirestoreErrorHandlerService,
    private globalErrorHandler: GlobalErrorHandlerService
  ) { }

  private fetchUser(uid: string): Observable<IUserDados | null> {
    const normalizedUid = uid.trim();

    // 🛑 Se a Observable já foi criada, reutiliza e evita chamadas extras
    if (this.userObservablesCache.has(normalizedUid)) {
      return this.userObservablesCache.get(normalizedUid)!;
    }

    console.log(`[FirestoreUserQueryService] Buscando usuário no cache: ${normalizedUid}`);

    return this.cacheService.get<IUserDados>(`user:${normalizedUid}`).pipe(
      switchMap(cachedUser => {
        if (cachedUser) {
          console.log(`[CacheService] Usuário encontrado no cache:`, cachedUser);
          return of(cachedUser);
        }

        // 2️⃣ Verifica no Store (NgRx)
        return this.store.select(selectUserProfileDataByUid(normalizedUid)).pipe(
          take(1),
          switchMap(userFromStore => {
            if (userFromStore) {
              console.log(`[NgRx Store] Usuário encontrado no Store:`, userFromStore);
              this.cacheService.set(`user:${normalizedUid}`, userFromStore, 300000);
              return of(userFromStore);
            }

        // 3️⃣ Se não estiver no Store, busca no Firestore
        return this.fetchUserFromFirestore(normalizedUid);
          })
        );
      }),
      shareReplay(1)
    );
  }

  /**
   * Busca o usuário diretamente no Firestore, tratando erros e atualizando o cache e Store.
   */
  private fetchUserFromFirestore(uid: string): Observable < IUserDados | null > {
        console.log(`[FirestoreUserQueryService] Buscando usuário ${uid} no Firestore...`);
        const docRef = doc(this.db, 'users', uid);
        return from(getDoc(docRef)).pipe(
          map(docSnap => {
            if (docSnap.exists()) {
              const userData = docSnap.data() as IUserDados;
              this.store.dispatch(addUserToState({ user: userData }));
              this.cacheService.set(`user:${uid}`, userData, 300000);
              return userData;
            } else {
              console.log(`[FirestoreUserQueryService] Usuário ${uid} não encontrado.`);
              return null;
            }
          }),
          catchError(error => this.firestoreErrorHandler.handleFirestoreError(error))
        );
      }


  getUser(uid: string): Observable<IUserDados | null> {
    return this.fetchUser(uid);
  }

  getUserById(uid: string): Observable<IUserDados | null> {
    console.log(`[FirestoreUserQueryService] Método getUserById foi chamado.`);
    return this.fetchUser(uid);
  }

  getUserWithObservable(uid: string): Observable<IUserDados | null> {
    const normalizedUid = uid.trim();

    // Se já existe uma requisição pendente, reutiliza a observável existente
    if (this.userObservablesCache.has(normalizedUid)) {
      return this.userObservablesCache.get(normalizedUid)!;
    }

    const userObservable = this.fetchUser(normalizedUid).pipe(
      shareReplay(1) // Evita múltiplas chamadas simultâneas para o mesmo usuário
    );

    this.userObservablesCache.set(normalizedUid, userObservable);
    return userObservable;
  }

  /**
   * Obtém os dados do usuário diretamente do Firestore.
   * @param uid UID do usuário.
   */
  async getUserData(uid: string): Promise<IUserDados | null> {
    if (!uid.trim()) return null;

    const cacheKey = `user:${uid}`;

    const cachedUser = await firstValueFrom(this.cacheService.get<IUserDados>(cacheKey));
    if (cachedUser) return cachedUser;

    try {
      const userDoc = await getDoc(doc(this.db, 'users', uid));
      if (userDoc.exists()) {
        const userData = userDoc.data() as IUserDados;
        this.cacheService.set(cacheKey, userData, 300000);
        return userData;
      }
      return null;
    } catch (error) {
      console.log(`Erro ao buscar usuário ${uid}:`, error);
      this.globalErrorHandler.handleError(error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }


  /**
   * Atualiza os dados do usuário no cache e no estado.
   * @param uid UID do usuário.
   * @param updatedData Dados atualizados.
   */
  updateUserInStateAndCache<T extends IUserRegistrationData | IUserDados>(uid: string, updatedData: T): void {
    // Flexibilidade para lidar com diferentes tipos de dados
    const cacheKey = `user:${uid}`;
    // 🚀 Resolva o valor do cache antes de compará-lo
    this.cacheService.get<T>(cacheKey).pipe(take(1)).subscribe(cachedUser => {
      if (cachedUser && JSON.stringify(cachedUser) === JSON.stringify(updatedData)) {
        console.log(`[FirestoreUserQueryService] Dados do usuário ${uid} já atualizados no cache e estado.`);
        return;
      }

      // Atualiza o cache e o estado, independentemente do tipo
      this.cacheService.set(cacheKey, updatedData, 300000); // TTL de 5 minutos
      this.store.dispatch(updateUserInState({ uid, updatedData } as any)); // `as any` para manter compatibilidade com NgRx
      console.log(`[FirestoreUserQueryService] Dados do usuário ${uid} atualizados no cache e estado.`);
    });
  }

}
