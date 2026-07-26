// src/app/preferences/services/preference-profile-persistence.service.ts
// -----------------------------------------------------------------------------
// PERSISTÊNCIA ATÔMICA DO PERFIL DE PREFERÊNCIAS
// -----------------------------------------------------------------------------
// O perfil privado e sua projeção de discovery precisam mudar juntos. Uma escrita
// parcial faria o editor mostrar uma escolha que a descoberta ainda ignoraria.
// Por isso as duas gravações usam o mesmo writeBatch do Firestore.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import { Firestore, doc } from '@angular/fire/firestore';
import { writeBatch } from 'firebase/firestore';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { FirestoreContextService } from '@core/services/data-handling/firestore/core/firestore-context.service';

import { IntentState } from '../models/intent-state.model';
import { PreferenceProfile } from '../models/preference-profile.model';
import { buildPreferenceDiscoveryProjection } from '../utils/preference-discovery-projection.util';

@Injectable({ providedIn: 'root' })
export class PreferenceProfilePersistenceService {
  private readonly db = inject(Firestore);
  private readonly context = inject(FirestoreContextService);

  saveProfileWithProjection$(
    uid: string,
    profile: PreferenceProfile
  ): Observable<void> {
    return this.commit$(uid, profile, null);
  }

  saveAllWithProjection$(
    uid: string,
    profile: PreferenceProfile,
    intent: IntentState
  ): Observable<void> {
    return this.commit$(uid, profile, intent);
  }

  private commit$(
    uid: string,
    profile: PreferenceProfile,
    intent: IntentState | null
  ): Observable<void> {
    const safeUid = (uid ?? '').trim();

    if (!safeUid) {
      throw new Error('[PreferenceProfilePersistenceService] UID inválido.');
    }

    const now = Date.now();
    const safeProfile: PreferenceProfile = {
      ...profile,
      userId: safeUid,
      updatedAt: now,
    };
    const projection = buildPreferenceDiscoveryProjection(safeProfile);

    const profileRef = this.context.run(() =>
      doc(this.db, 'users', safeUid, 'preferences', 'profile')
    );
    const userRef = this.context.run(() => doc(this.db, 'users', safeUid));
    const intentRef = intent
      ? this.context.run(() =>
          doc(this.db, 'users', safeUid, 'preferences', 'intent')
        )
      : null;

    return this.context.deferPromise$(async () => {
      const batch = writeBatch(this.db as any);

      batch.set(profileRef as any, safeProfile as any);
      batch.set(
        userRef as any,
        {
          interestedInGenders: projection.interestedInGenders,
          discoveryPreferences: projection.discoveryPreferences,
          discoveryPreferencesUpdatedAt: now,
        } as any,
        { merge: true }
      );

      if (intentRef && intent) {
        batch.set(intentRef as any, {
          ...intent,
          userId: safeUid,
          updatedAt: now,
        } as any);
      }

      await batch.commit();
    }).pipe(map(() => void 0));
  }
}
