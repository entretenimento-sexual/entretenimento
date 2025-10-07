// src/app/core/services/general/cache/cache-sync.service.ts
import { Injectable, inject } from '@angular/core';
import { Firestore, collection, onSnapshot } from '@angular/fire/firestore'; // 👈 use @angular/fire
import { CacheService } from './cache.service';
import { Observable } from 'rxjs';
import { CachePersistenceService } from './cache-persistence.service';

@Injectable({ providedIn: 'root' })
export class CacheSyncService {
  private db = inject(Firestore); // ✅ injetado

  constructor(
    private cacheService: CacheService,
    private cachePersistence: CachePersistenceService
  ) { }

  syncFirestoreCollection(collectionName: string): Observable<void> {
    return new Observable(observer => {
      const ref = collection(this.db, collectionName); // ✅ usa db injetado

      const unsubscribe = onSnapshot(ref, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'modified' || change.type === 'added') {
            const data = change.doc.data();
            const key = `${collectionName}:${change.doc.id}`;
            console.log(`[CacheSyncService] Sincronizando "${key}" com Firestore.`);

            this.cacheService.set(key, data);
            this.cachePersistence.setPersistent(key, data).subscribe(() => {
              console.log(`[CacheSyncService] Dados sincronizados e salvos no IndexedDB.`);
            });
          }
        });

        observer.next();
      });

      return () => {
        unsubscribe();
        observer.complete();
      };
    });
  }
}
