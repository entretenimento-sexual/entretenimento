//src\app\core\services\general\cache\cache+store\data-sync.service.ts
// Serviço para sincronização de dados entre Cache, Store e Firestore
// Não esquecer os comentários
// objetivo de descontinuar o DataSyncService
import { Injectable } from '@angular/core';
import { CacheService } from '../cache.service';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { Observable, of, switchMap, take, tap, catchError } from 'rxjs';
import { GlobalErrorHandlerService } from '../../../error-handler/global-error-handler.service';
import { FirestoreService } from '../../../data-handling/legacy/firestore.service';
import { WithFieldValue, DocumentData, QueryConstraint } from 'firebase/firestore';
import { environment } from 'src/environments/environment';

/** @deprecated Use QueryServices + CacheService ou NgRx Effects (realtime). */
@Injectable({ providedIn: 'root' })
export class DataSyncService {
  private readonly debug = !environment.production;
  private warn(msg: string) { if (this.debug) console.warn(`[DataSyncService][DEPRECATED] ${msg}`); }

  constructor(
    private cacheService: CacheService,
    private store: Store<AppState>,
    private firestoreService: FirestoreService, // ✅ Usando FirestoreService
    private globalErrorHandler: GlobalErrorHandlerService
  ) { }

  /**
   * 🔍 Obtém dados do cache/store antes de ir ao Firestore.
   * ✅ Atualiza o cache/store automaticamente se precisar buscar do Firestore.
   */
  getData<T>(
    cacheKey: string,
    storeSelector: (state: AppState) => T | T[],
    collectionName: string,
    constraints: QueryConstraint[] = []
  ): Observable<T | T[]> {
    return this.cacheService.get<T | T[]>(cacheKey).pipe(
      switchMap(cachedData => {
        if (cachedData !== null && cachedData !== undefined) {
          console.log(`✅ [Cache] Dados encontrados no cache para ${cacheKey}:`, cachedData);
          return of(cachedData);
        }

        return this.store.select(storeSelector).pipe(
          take(1),
          switchMap(storeData => {
            if (storeData !== null && storeData !== undefined) {
              console.log(`✅ [Store] Dados encontrados no Store para ${cacheKey}:`, storeData);
              this.cacheService.set(cacheKey, storeData, 300000);
              return of(storeData);
            }

            console.log(`⚠️ Nenhum dado encontrado no Cache ou Store para ${cacheKey}. Buscando no Firestore...`);
            return this.fetchFromFirestore<T>(collectionName, constraints, cacheKey);
          })
        );
      })
    );
  }

  //Busca dados do Firestore e atualiza cache/store.
  private fetchFromFirestore<T>(
    collectionName: string,
    constraints: QueryConstraint[],
    cacheKey: string
  ): Observable<T[]> {
    return this.firestoreService.getDocuments<T>(collectionName, constraints).pipe(
      tap(data => {
        if (data.length > 0) { // ✅ Apenas armazena se houver dados
          console.log(`✅ [Firestore] Dados carregados de ${collectionName}:`, data);
          this.cacheService.set(cacheKey, data, 300000);
        } else {
          console.log(`⚠️ Nenhum dado encontrado no Firestore para ${collectionName}.`);
        }
      }),
      catchError(error => {
        this.globalErrorHandler.handleError(error);
        return of([] as T[]);
      })
    );
  }

  /**
   * 🔄 Atualiza dados no Firestore e sincroniza cache/store.
   * ✅ Evita sobreposição e mantém consistência.
   */
  saveData<T extends WithFieldValue<DocumentData>>(
    cacheKey: string,
    storeSelector: (state: AppState) => T[],
    collectionName: string,
    docId: string,
    newData: T
  ): Observable<void> {
    return this.store.select(storeSelector).pipe(
      take(1),
      switchMap(existingData => {
        const exists = existingData.some(d => d['id'] === newData['id']);
        if (exists) {
          console.log(`⚠️ Dado já existe no estado: ${docId}, evitando duplicação.`);
          return of(void 0);
        }

        const updatedData = [...existingData, newData];
        console.log(`✅ Atualizando cache/store para ${cacheKey}:`, updatedData);
        this.cacheService.set(cacheKey, updatedData, 300000);

        return this.firestoreService.updateDocument(collectionName, docId, newData).pipe(
          tap(() => console.log(`✅ [Firestore] Dados atualizados em ${collectionName}/${docId}.`)),
          catchError(error => {
            console.log(`❌ Erro ao atualizar no Firestore:`, error);
            return of(void 0);
          })
        );
      })
    );
  }


  //Remove um documento do Firestore e sincroniza cache/store.
  deleteDocument(collectionName: string, docId: string): Observable<void> {
    return this.firestoreService.deleteDocument(collectionName, docId).pipe(
      tap(() => console.log(`✅ [Firestore] Documento removido: ${collectionName}/${docId}`)),
      catchError(error => {
        this.globalErrorHandler.handleError(error);
        return of(void 0);
      })
    );
  }
}
