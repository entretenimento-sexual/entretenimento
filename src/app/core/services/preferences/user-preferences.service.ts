// src\app\core\services\preferences\user-preferences.service.ts
import { Injectable } from '@angular/core';
import { Firestore, collection, doc, getDocs, query, setDoc, where } from '@angular/fire/firestore';
import { Observable, from, of, throwError } from 'rxjs';
import { map, switchMap, tap, catchError, distinctUntilChanged, shareReplay } from 'rxjs/operators';
import { IUserPreferences } from '../../interfaces/interfaces-user-dados/iuser-preferences';
import { FirestoreService } from '../data-handling/firestore.service';
import { CacheService } from '../general/cache/cache.service';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../error-handler/error-notification.service';
import { loadUserPreferencesSuccess, updateUserPreferences } from '../../../store/actions/actions.user/user-preferences.actions';
import { selectUserPreferences } from '../../../store/selectors/selectors.user/user-preferences.selectors';

@Injectable({
  providedIn: 'root'
})
export class UserPreferencesService {
  private db: Firestore;

  constructor(
    private firestoreService: FirestoreService,
    private cacheService: CacheService,
    private store: Store<AppState>,
    private errorHandler: GlobalErrorHandlerService,
    private notifier: ErrorNotificationService
  ) {
    this.db = this.firestoreService.getFirestoreInstance();
  }

  /**
   * Salva as preferências do usuário, atualizando cache e Store.
   * @param uid ID do usuário
   * @param preferences Preferências a serem salvas
   * @returns Observable<void>
   */
  saveUserPreferences$(uid: string, preferences: Partial<IUserPreferences>): Observable<void> {
    return from(this.saveUserPreferencesInternal(uid, preferences)).pipe(
      tap(() => {
        // Atualiza Store e cache após a gravação bem-sucedida
        this.cacheService.update(`preferences:${uid}`, preferences);
        this.store.dispatch(updateUserPreferences({ uid, preferences }));
      }),
      catchError(err => {
        this.errorHandler.handleError(err);
        this.notifier.showError('Erro ao salvar preferências, tente novamente mais tarde.');
        return throwError(() => err);
      })
    );
  }

  /**
   * Operação interna assíncrona para salvar preferências no Firestore.
   * @param uid ID do usuário
   * @param preferences Preferências do usuário
   */
  private async saveUserPreferencesInternal(uid: string, preferences: Partial<IUserPreferences>): Promise<void> {
    const userRef = doc(this.db, `users/${uid}`);
    const preferencesCollection = collection(userRef, 'preferences');

    for (const [category, arrayOfValues] of Object.entries(preferences)) {
      const prefDocRef = doc(preferencesCollection, category);
      await setDoc(prefDocRef, { value: arrayOfValues }, { merge: true });
    }
  }

  /**
   * Obtém as preferências do usuário, priorizando cache e Store antes do Firestore.
   * @param uid ID do usuário
   * @returns Observable<IUserPreferences>
   */
  getUserPreferences$(uid: string): Observable<IUserPreferences> {
    return this.store.select(selectUserPreferences(uid)).pipe(
      distinctUntilChanged(),
      switchMap((storedPreferences) => {
        if (storedPreferences) {
          return of(storedPreferences);
        }

        return this.cacheService.get<IUserPreferences>(`preferences:${uid}`).pipe(
          switchMap((cachedPref) => {
            if (cachedPref) {
              return of(cachedPref);
            }
            return from(this.getUserPreferencesInternal(uid)).pipe(
              tap(pref => {
                if (pref) {
                  this.cacheService.set(`preferences:${uid}`, pref);
                  this.store.dispatch(loadUserPreferencesSuccess({ uid, preferences: pref }));
                }
              })
            );
          })
        );
      }),
      catchError(err => {
        this.errorHandler.handleError(err);
        this.notifier.showError('Erro ao carregar preferências do usuário.');
        return throwError(() => err);
      }),
      shareReplay(1)
    );
  }

  /**
   * Operação interna assíncrona para buscar preferências do Firestore.
   * @param uid ID do usuário
   */
  private async getUserPreferencesInternal(uid: string): Promise<IUserPreferences> {
    const preferences: IUserPreferences = {
      genero: [],
      praticaSexual: [],
      preferenciaFisica: [],
      relacionamento: []
    };

    const preferencesCollectionRef = collection(this.db, `users/${uid}/preferences`);
    const querySnapshot = await getDocs(preferencesCollectionRef);

    querySnapshot.forEach((prefDoc) => {
      const data = prefDoc.data();
      preferences[prefDoc.id] = data['value'] || [];
    });

    return preferences;
  }

  /**
   * Obtém preferências baseadas em token (pré-cadastro).
   * @param token Token gerado no pré-registro
   * @returns Observable<any | null>
   */
  getUserPreferencesByToken$(token: string): Observable<any | null> {
    const preRegisterCollection = collection(this.db, "preRegisterPreferences");
    const preRegisterQuery = query(preRegisterCollection, where("token", "==", token));

    return from(getDocs(preRegisterQuery)).pipe(
      map(snap => snap.empty ? null : snap.docs[0].data()),
      catchError(err => {
        this.errorHandler.handleError(err);
        this.notifier.showError('Erro ao buscar preferências pelo token.');
        return of(null);
      })
    );
  }
}
