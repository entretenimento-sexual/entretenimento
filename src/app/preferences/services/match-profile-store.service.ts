// src/app/preferences/services/match-profile-store.service.ts
// Persistência do documento derivado de match/discovery.
//
// Responsabilidade:
// - ler/gravar o MatchProfile materializado
// - não conhece UI
// - não conhece legado
// - não decide como o profile é construído; isso fica no builder

import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay, take } from 'rxjs/operators';

import { FirestoreReadService } from '@core/services/data-handling/firestore/core/firestore-read.service';
import { FirestoreWriteService } from '@core/services/data-handling/firestore/core/firestore-write.service';

import { MatchProfile } from '../models/match-profile.model';
import { createEmptyMatchProfile } from '../utils/preference-normalizers';
import { preferencePaths } from '../utils/preference-paths';

@Injectable({ providedIn: 'root' })
export class MatchProfileStoreService {
  private readonly read = inject(FirestoreReadService);
  private readonly write = inject(FirestoreWriteService);

  getMatchProfile$(uid: string): Observable<MatchProfile> {
    const userId = this.normalizeUid(uid);
    if (!userId) return of(createEmptyMatchProfile(''));

    const [collectionName, docId] = this.splitPath(preferencePaths.matchProfile(userId));

    return this.read.getDocumentLiveSafe<MatchProfile>(collectionName, docId, {
      requireAuth: true,
    }).pipe(
      map((profile) => profile ?? createEmptyMatchProfile(userId)),
      catchError(() => of(createEmptyMatchProfile(userId))),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  saveMatchProfile$(uid: string, matchProfile: MatchProfile): Observable<void> {
    const userId = this.normalizeUid(uid);
    if (!userId) return of(void 0);

    const [collectionName, docId] = this.splitPath(preferencePaths.matchProfile(userId));

    return this.write.setDocument(collectionName, docId, {
      ...matchProfile,
      userId,
      updatedAt: Date.now(),
    }).pipe(
      take(1),
      map(() => void 0)
    );
  }

  updateMatchProfile$(uid: string, patch: Partial<MatchProfile>): Observable<void> {
    const userId = this.normalizeUid(uid);
    if (!userId) return of(void 0);

    const [collectionName, docId] = this.splitPath(preferencePaths.matchProfile(userId));

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
   * match_profiles/{uid}
   * em:
   * collectionName = match_profiles
   * docId = {uid}
   */
  private splitPath(path: string): [string, string] {
    const parts = path.split('/');
    return [parts[0], parts[1]];
  }
}