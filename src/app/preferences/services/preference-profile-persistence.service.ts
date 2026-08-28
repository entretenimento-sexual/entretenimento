// src/app/preferences/services/preference-profile-persistence.service.ts
// -----------------------------------------------------------------------------
// PERSISTÊNCIA ATÔMICA DO PERFIL DE PREFERÊNCIAS
// -----------------------------------------------------------------------------
// Perfil, intenção opcional e projeção privada são gravados no mesmo batch.
// Somente após confirmação do Firestore o estado reativo local é atualizado.
// O feed paginado contém perfis públicos brutos, portanto permanece válido e é
// reavaliado imediatamente com a nova política do usuário.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import { Firestore, doc } from '@angular/fire/firestore';
import { Store } from '@ngrx/store';
import { writeBatch } from 'firebase/firestore';
import { Observable, throwError } from 'rxjs';
import { map, tap } from 'rxjs/operators';

import type { IUserDados } from '@core/interfaces/iuser-dados';
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { FirestoreContextService } from '@core/services/data-handling/firestore/core/firestore-context.service';
import { updateUserInState } from '@store/actions/actions.user/user.actions';
import type { AppState } from '@store/states/app.state';

import type { IntentState } from '../models/intent-state.model';
import type { PreferenceProfile } from '../models/preference-profile.model';
import { buildPreferenceDiscoveryProjection } from '../utils/preference-discovery-projection.util';
import { normalizePreferenceProfile } from '../utils/preference-normalizers';

@Injectable({ providedIn: 'root' })
export class PreferenceProfilePersistenceService {
  private readonly db = inject(Firestore);
  private readonly context = inject(FirestoreContextService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly store = inject(Store<AppState>);

  saveProfileWithProjection$(uid: string, profile: PreferenceProfile): Observable<void> {
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
      return throwError(
        () => new Error('[PreferenceProfilePersistenceService] UID inválido.')
      );
    }

    const now = Date.now();
    const safeProfile = normalizePreferenceProfile({
      ...profile,
      userId: safeUid,
      updatedAt: now,
    }, safeUid);
    const projection = buildPreferenceDiscoveryProjection(safeProfile);
    const userPatch: Partial<IUserDados> = {
      interestedInGenders: projection.interestedInGenders,
      discoveryPreferences: projection.discoveryPreferences,
      discoveryPreferencesUpdatedAt: now,
    };

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
      batch.set(userRef as any, userPatch as any, { merge: true });

      if (intentRef && intent) {
        batch.set(intentRef as any, {
          ...intent,
          userId: safeUid,
          updatedAt: now,
        } as any);
      }

      await batch.commit();
    }).pipe(
      tap(() => this.updateReactiveProjection(safeUid, userPatch)),
      map(() => void 0)
    );
  }

  private updateReactiveProjection(
    uid: string,
    patch: Partial<IUserDados>
  ): void {
    const current = this.currentUserStore.getSnapshot();
    if (!current || current.uid !== uid) return;

    const updated = { ...current, ...patch } as IUserDados;
    this.currentUserStore.patch(patch);
    this.store.dispatch(updateUserInState({ uid, updatedData: updated }));
  }
}
