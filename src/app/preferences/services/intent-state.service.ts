// src/app/preferences/services/intent-state.service.ts
// Serviço do domínio novo de intenção contextual.
//
// Responsabilidade:
// - ler/gravar o documento de intenção atual do usuário
// - separar "o que quero agora" das preferências estáveis
//
// Exemplos de uso futuro:
// - chat
// - casual
// - meet_today
// - travel
// - discreet
import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay, take } from 'rxjs/operators';

import { FirestoreReadService } from '@core/services/data-handling/firestore/core/firestore-read.service';
import { FirestoreWriteService } from '@core/services/data-handling/firestore/core/firestore-write.service';

import { IntentState } from '../models/intent-state.model';
import { createEmptyIntentState } from '../utils/preference-normalizers';
import { preferencePaths } from '../utils/preference-paths';

@Injectable({ providedIn: 'root' })
export class IntentStateService {
  private readonly read = inject(FirestoreReadService);
  private readonly write = inject(FirestoreWriteService);

  getIntentState$(uid: string): Observable<IntentState> {
    const userId = this.normalizeUid(uid);
    if (!userId) return of(createEmptyIntentState(''));

    const [collectionName, docId] = this.splitPath(preferencePaths.intent(userId));

    return this.read.getDocumentLiveSafe<IntentState>(collectionName, docId, {
      requireAuth: true,
    }).pipe(
      map((state) => state ?? createEmptyIntentState(userId)),
      catchError(() => of(createEmptyIntentState(userId))),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  saveIntentState$(uid: string, state: IntentState): Observable<void> {
    const userId = this.normalizeUid(uid);
    if (!userId) return of(void 0);

    const [collectionName, docId] = this.splitPath(preferencePaths.intent(userId));

    return this.write.setDocument(collectionName, docId, {
      ...state,
      userId,
      updatedAt: Date.now(),
    }).pipe(
      take(1),
      map(() => void 0)
    );
  }

  updateIntentState$(uid: string, patch: Partial<IntentState>): Observable<void> {
    const userId = this.normalizeUid(uid);
    if (!userId) return of(void 0);

    const [collectionName, docId] = this.splitPath(preferencePaths.intent(userId));

    return this.write.updateDocument(collectionName, docId, {
      ...patch,
      userId,
      updatedAt: Date.now(),
    }).pipe(
      take(1),
      map(() => void 0)
    );
  }

  private normalizeUid(uid: string): string {
    return (uid ?? '').trim();
  }

  /**
   * Converte:
   * users/{uid}/preferences/intent
   * em:
   * collectionName = users/{uid}/preferences
   * docId = intent
   */
  private splitPath(path: string): [string, string] {
    const parts = path.split('/');
    return [`${parts[0]}/${parts[1]}/${parts[2]}`, parts[3]];
  }
}