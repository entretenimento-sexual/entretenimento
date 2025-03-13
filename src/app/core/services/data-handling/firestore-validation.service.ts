//src\app\core\services\data-handling\firestore-validation.service.ts
import { Injectable } from '@angular/core';
import { where } from 'firebase/firestore';
import { Observable, of } from 'rxjs';
import { map, catchError, take, switchMap, tap } from 'rxjs/operators';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { FirestoreService } from './firestore.service';
import { CacheService } from '../general/cache/cache.service';
import { NotificationService } from '../general/notification.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import * as userActions from 'src/app/store/actions/actions.user/user.actions';

@Injectable({
  providedIn: 'root'
})
export class FirestoreValidationService {
  constructor(
    private firestoreService: FirestoreService,
    private cacheService: CacheService,
    private store: Store<AppState>,
    private notifier: NotificationService,
    private globalErrorHandler: GlobalErrorHandlerService
  ) { }

  checkIfNicknameExists(nickname: string): Observable<boolean> {
    const normalizedNickname = nickname.trim().toLowerCase();
    const cacheKey = `validation:nickname:${normalizedNickname}`;

    return this.cacheService.get<boolean>(cacheKey).pipe(
      switchMap(cachedResult => {
        if (cachedResult !== null) {
          console.log(`✅ [Cache] Nickname '${nickname}' validado via cache.`);
          return of(cachedResult);
        }

        return this.store.select(state =>
          Object.values(state.user.users)
            .map(u => u.nickname?.toLowerCase())
            .filter((nickname): nickname is string => !!nickname)
        ).pipe(
          take(1),
          switchMap((storedNicknames: string[]) => {
            if (storedNicknames.includes(normalizedNickname)) {
              console.log(`✅ [Store] Nickname '${nickname}' validado via store.`);
              this.cacheService.set(cacheKey, true, 300000);
              return of(true);
            }

            console.log(`🔍 [Firestore] Consultando nickname '${nickname}' no Firestore.`);
            return this.firestoreService.getDocuments<any>('users', [
              where('nickname', '==', nickname.trim())
            ], false).pipe(
              map(results => results.length > 0),
              tap(exists => {
                this.cacheService.set(cacheKey, exists, 300000);
                // Aqui você NÃO PRECISA ADICIONAR NADA AO ESTADO.
                // Pois a store será atualizada naturalmente ao adicionar novos usuários.
              }),
              catchError(error => {
                this.notifier.showError('Erro ao validar apelido. Tente novamente.');
                this.globalErrorHandler.handleError(error);
                return of(false);
              })
            );
          })
        );
      })
    )
  }
}
