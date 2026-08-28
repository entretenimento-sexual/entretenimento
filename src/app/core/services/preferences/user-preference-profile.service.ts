// src/app/core/services/preferences/user-preference-profile.service.ts
// Não esquecer comentários explicativos e ferramentas de debug
// cosiderar sempre o role do usuário para interações diversas e visualizações
import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay, take } from 'rxjs/operators';

import { FirestoreReadService } from '@core/services/data-handling/firestore/core/firestore-read.service';
import { FirestoreWriteService } from '@core/services/data-handling/firestore/core/firestore-write.service';
import { IUserPreferenceProfile } from '@core/interfaces/preferences/user-preference-profile.interface';
import { createEmptyPreferenceProfile } from '@core/utils/preferences/preference-normalizers';
import { preferencePaths } from '@core/utils/preferences/preference-paths';

@Injectable({ providedIn: 'root' })
export class UserPreferenceProfileService {
  private readonly read = inject(FirestoreReadService);
  private readonly write = inject(FirestoreWriteService);

  getPreferenceProfile$(uid: string): Observable<IUserPreferenceProfile> {
    const id = (uid ?? '').trim();
    if (!id) return of(createEmptyPreferenceProfile(''));

    const [collectionName, docId] = this.splitPath(preferencePaths.profileMain(id));

    return this.read.getDocumentLiveSafe<IUserPreferenceProfile>(collectionName, docId, {
      requireAuth: true,
    }).pipe(
      map((profile) => profile ?? createEmptyPreferenceProfile(id)),
      catchError(() => of(createEmptyPreferenceProfile(id))),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  savePreferenceProfile$(uid: string, profile: IUserPreferenceProfile): Observable<void> {
    const id = (uid ?? '').trim();
    if (!id) return of(void 0);

    const [collectionName, docId] = this.splitPath(preferencePaths.profileMain(id));

    return this.write.setDocument(collectionName, docId, {
      ...profile,
      userId: id,
      updatedAt: Date.now(),
    }).pipe(
      take(1),
      map(() => void 0)
    );
  }

  updatePreferenceProfile$(
    uid: string,
    patch: Partial<IUserPreferenceProfile>
  ): Observable<void> {
    const id = (uid ?? '').trim();
    if (!id) return of(void 0);

    const [collectionName, docId] = this.splitPath(preferencePaths.profileMain(id));

    return this.write.updateDocument(collectionName, docId, {
      ...patch,
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