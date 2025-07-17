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

    // Evita verificar apelidos inválidos ou vazios
    if (!normalizedNickname || normalizedNickname.length < 3) {
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
        return this.firestoreService.getDocuments<any>('public_index', [
          where('type', '==', 'nickname'),
          where('value', '==', normalizedNickname)
        ], false).pipe(
          map(results => results.length > 0),
          tap(exists => {
            if (!exists) {
              // Cacheia somente se não existir
              this.cacheService.set(cacheKey, exists, 60000); // 1 minuto
              console.log(`📦 [Cache] Nickname '${nickname}' disponível e armazenado.`);
            } else {
              console.log(`⚠️ Nickname '${nickname}' já em uso. Não cacheado.`);
            }
          }),
          catchError(error => {
            console.log('🔥 Erro na verificação de apelido no Firestore:', error);
            this.notifier.showError('Erro ao validar apelido. Tente novamente.');
            this.globalErrorHandler.handleError(error);
            return of(false);
          })
        );
      })
    );
  }

}
