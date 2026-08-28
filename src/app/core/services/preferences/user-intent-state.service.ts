// Não esquecer comentários explicativos e ferramentas de debug
// cosiderar sempre o role do usuário para interações diversas e visualizações
// src/app/core/services/preferences/user-intent-state.service.ts
import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay, take } from 'rxjs/operators';

import { FirestoreReadService } from '@core/services/data-handling/firestore/core/firestore-read.service';
import { FirestoreWriteService } from '@core/services/data-handling/firestore/core/firestore-write.service';
import { IUserIntentState } from '@core/interfaces/preferences/user-intent-state.interface';
import { createEmptyIntentState } from '@core/utils/preferences/preference-normalizers';
import { preferencePaths } from '@core/utils/preferences/preference-paths';

@Injectable({ providedIn: 'root' })
export class UserIntentStateService {
  private readonly read = inject(FirestoreReadService);
  private readonly write = inject(FirestoreWriteService);

  getIntentState$(uid: string): Observable<IUserIntentState> {
    const id = (uid ?? '').trim();
    if (!id) return of(createEmptyIntentState(''));

    const [collectionName, docId] = this.splitPath(preferencePaths.intentCurrent(id));

    return this.read.getDocumentLiveSafe<IUserIntentState>(collectionName, docId, {
      requireAuth: true,
    }).pipe(
      map((state) => state ?? createEmptyIntentState(id)),
      catchError(() => of(createEmptyIntentState(id))),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  saveIntentState$(uid: string, state: IUserIntentState): Observable<void> {
    const id = (uid ?? '').trim();
    if (!id) return of(void 0);

    const [collectionName, docId] = this.splitPath(preferencePaths.intentCurrent(id));

    return this.write.setDocument<IUserIntentState>(collectionName, docId, {
      ...state,
      userId: id,
      updatedAt: Date.now(),
    }).pipe(
      take(1),
      map(() => void 0)
    );
  }

  private splitPath(path: string): [string, string] {
    const parts = path.split('/');
    return [`${parts[0]}/${parts[1]}/${parts[2]}`, parts[3]];
  }
}