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
  ) { }

  checkIfNicknameExists(nickname: string): Observable<boolean> {
    const normalized = nickname.trim().toLowerCase();
    const cacheKey = `validation:nickname:${normalized}`;

    // evita consultas desnecessárias
    if (!normalized || normalized.length < 4) {
      console.log(`⚠️ Apelido inválido/curto ignorado: '${nickname}'`);
      return of(false);
    }

    return this.cacheService.get<boolean>(cacheKey).pipe(
      switchMap(cached => {
        if (cached !== null) {
          console.log(`✅ [Cache] nickname '${normalized}': ${cached}`);
          return of(cached);
        }

        console.log(`🔍 [Firestore] lookup O(1) de '${normalized}' em public_index via docId`);
        return this.firestoreService.checkNicknameIndexExists(normalized).pipe(
          tap(exists => {
            // cache para ambos os resultados; TTL de 60s é um bom equilíbrio
            this.cacheService.set(cacheKey, exists, 60_000);
          }),
          catchError(err => {
            // não travar UX do blur por falha transitória de rede
            console.log('🔥 Falha silenciosa no validator de apelido:', err);
            return of(false);
          })
        );
      })
    );
  }
}
