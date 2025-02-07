//src\app\core\services\general\cache\cache-sync.service.ts
import { Injectable } from '@angular/core';
import { collection, onSnapshot, getFirestore } from 'firebase/firestore';
import { CacheService } from './cache.service';
import { from, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class CacheSyncService {
  constructor(private cacheService: CacheService) { }

  syncFirestoreCollection(collectionName: string): Observable<void> {
    return new Observable(observer => {
      const db = getFirestore();
      const ref = collection(db, collectionName);

      const unsubscribe = onSnapshot(ref, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'modified' || change.type === 'added') {
            this.cacheService.set(`${collectionName}:${change.doc.id}`, change.doc.data());
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
