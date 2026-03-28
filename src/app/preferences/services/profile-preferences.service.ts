// src/app/preferences/services/profile-preferences.service.ts
// Serviço do domínio novo de preferências estáveis.
//
// Responsabilidade:
// - ler/gravar o documento canônico de preferências estáveis
// - não conhece legado
// - não conhece UI
// - não duplica role no documento
//
// Observação:
// - role continua canônico em IUserDados / auth/session
// - este service trata apenas do documento preferences/profile

import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay, take } from 'rxjs/operators';

import { FirestoreReadService } from '@core/services/data-handling/firestore/core/firestore-read.service';
import { FirestoreWriteService } from '@core/services/data-handling/firestore/core/firestore-write.service';

import { PreferenceProfile } from '../models/preference-profile.model';
import { createEmptyPreferenceProfile } from '../utils/preference-normalizers';
import { preferencePaths } from '../utils/preference-paths';

@Injectable({ providedIn: 'root' })
export class ProfilePreferencesService {
  private readonly read = inject(FirestoreReadService);
  private readonly write = inject(FirestoreWriteService);

  getProfile$(uid: string): Observable<PreferenceProfile> {
    const userId = this.normalizeUid(uid);
    if (!userId) return of(createEmptyPreferenceProfile(''));

    const [collectionName, docId] = this.splitPath(preferencePaths.profile(userId));

    return this.read.getDocumentLiveSafe<PreferenceProfile>(collectionName, docId, {
      requireAuth: true,
    }).pipe(
      map((profile) => profile ?? createEmptyPreferenceProfile(userId)),
      catchError(() => of(createEmptyPreferenceProfile(userId))),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  saveProfile$(uid: string, profile: PreferenceProfile): Observable<void> {
    const userId = this.normalizeUid(uid);
    if (!userId) return of(void 0);

    const [collectionName, docId] = this.splitPath(preferencePaths.profile(userId));

    return this.write.setDocument(collectionName, docId, {
      ...profile,
      userId,
      updatedAt: Date.now(),
    }).pipe(
      take(1),
      map(() => void 0)
    );
  }

  updateProfile$(uid: string, patch: Partial<PreferenceProfile>): Observable<void> {
    const userId = this.normalizeUid(uid);
    if (!userId) return of(void 0);

    const [collectionName, docId] = this.splitPath(preferencePaths.profile(userId));

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
   * users/{uid}/preferences/profile
   * em:
   * collectionName = users/{uid}/preferences
   * docId = profile
   */
  private splitPath(path: string): [string, string] {
    const parts = path.split('/');
    return [`${parts[0]}/${parts[1]}/${parts[2]}`, parts[3]];
  }
}