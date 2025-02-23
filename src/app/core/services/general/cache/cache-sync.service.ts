//src\app\core\services\general\cache\cache-sync.service.ts
import { Injectable } from '@angular/core';
import { collection, onSnapshot, getFirestore } from 'firebase/firestore';
import { CacheService } from './cache.service';
import { Observable } from 'rxjs';
import { CachePersistenceService } from './cache-persistence.service';

@Injectable({
  providedIn: 'root'
})
export class CacheSyncService {
  constructor(private cacheService: CacheService,
              private cachePersistence: CachePersistenceService
            ) { }

  syncFirestoreCollection(collectionName: string): Observable<void> {
    return new Observable(observer => {
      const db = getFirestore();
      const ref = collection(db, collectionName);

      const unsubscribe = onSnapshot(ref, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'modified' || change.type === 'added') {
            const data = change.doc.data();
            const key = `${collectionName}:${change.doc.id}`;

            console.log(`[CacheSyncService] Sincronizando "${key}" com Firestore.`);

            // ✅ Atualiza cache em memória
            this.cacheService.set(key, data);

            // ✅ Persiste no IndexedDB
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
