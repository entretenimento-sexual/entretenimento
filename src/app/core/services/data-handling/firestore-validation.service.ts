//src\app\core\services\data-handling\firestore-validation.service.ts
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map, catchError, switchMap, tap } from 'rxjs/operators';
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

    // Evita verificar apelidos inválidos ou vazios
    if (!normalizedNickname || normalizedNickname.length < 4) {
      console.log(`⚠️ Apelido em branco ou inválido ignorado: '${nickname}'`);
      return of(false);
    }

    return this.cacheService.get<boolean>(cacheKey).pipe(
      switchMap(cachedResult => {
        if (cachedResult !== null) {
          console.log(`✅ [Cache] Nickname '${nickname}' validado via cache: ${cachedResult}`);
          return of(cachedResult);
        }

        console.log(`🔍 [Firestore] Consultando apelido '${normalizedNickname}' na coleção 'public_index'.`);
        return this.firestoreService.getDocuments<any>('public_index', [], false).pipe(
          map(results =>
            results.some(d =>
              (d?.type === 'nickname') &&
              (String(d?.value || '').toLowerCase() === normalizedNickname)
            )
          ),
          tap(exists => {
            if (!exists) this.cacheService.set(cacheKey, exists, 60000);
          }),
          // em caso de falha, não propaga erro crítico pro usuário no blur
          catchError(error => {
            console.log('🔥 Erro na verificação de apelido no Firestore (silenciado no validator):', error);
            return of(false);
          })
        );
      })
    );
  }
}
