//src\app\core\services\general\cache\cache-persistence.service.ts
import { Injectable } from '@angular/core';
import { set, get, del } from 'idb-keyval';
import { from, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class CachePersistenceService {

  setPersistent<T>(key: string, value: T): Observable<void> {
    return from(set(key, value)); // ✅ Retornando um Observable
  }

  getPersistent<T>(key: string): Observable<T | null> {
    return from(get<T>(key).then(result => result !== undefined ? result : null)); // ✅ Evita `undefined`
  }

  deletePersistent(key: string): Observable<void> {
    return from(del(key)); // ✅ Mantendo a padronização com `Observable`
  }
}
