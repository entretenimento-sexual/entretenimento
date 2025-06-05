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

        console.log(`🔍 [Firestore] Consultando apelido '${nickname}' na coleção 'public_index'.`);
        return this.firestoreService.getDocuments<any>('public_index', [
          where('type', '==', 'nickname'),
          where('value', '==', normalizedNickname)
        ], false).pipe(
          map(results => results.length > 0),
          tap(exists => {
            this.cacheService.set(cacheKey, exists, 300000); // 5 minutos
            console.log(`📦 [Cache] Nickname '${nickname}' armazenado com valor: ${exists}`);
          }),
          catchError(error => {
            this.notifier.showError('Erro ao validar apelido. Tente novamente.');
            this.globalErrorHandler.handleError(error);
            return of(false); // fallback para não bloquear o registro
          })
        );
      })
    );
  }
}
