// src/app/preferences/application/preferences.facade.ts
// Fachada de leitura do domínio de preferências.
//
// Objetivo:
// - expor uma VM única para telas futuras do domínio preferences
// - combinar usuário canônico + preference profile + intent state + capacidades
// - manter a UI desacoplada dos services internos
//
// Observação:
// - não toca no legado
// - não salva nada
// - role continua vindo de IUserDados / CurrentUserStoreService

import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, of } from 'rxjs';
import { distinctUntilChanged, map, shareReplay } from 'rxjs/operators';

import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { IUserDados } from '@core/interfaces/iuser-dados';

import { PreferenceProfile } from '../models/preference-profile.model';
import { IntentState } from '../models/intent-state.model';
import { MatchProfile } from '../models/match-profile.model';

import { ProfilePreferencesService } from '../services/profile-preferences.service';
import { IntentStateService } from '../services/intent-state.service';
import { MatchProfileBuilderService } from '../services/match-profile-builder.service';
import {
  PreferencesCapabilityService,
  PreferencesCapabilitySnapshot,
} from '../services/preferences-capability.service';

export interface PreferencesViewModel {
  uid: string;
  user: IUserDados | null;
  profile: PreferenceProfile;
  intent: IntentState;
  matchProfile: MatchProfile | null;
  capabilities: PreferencesCapabilitySnapshot;
}

@Injectable({ providedIn: 'root' })
export class PreferencesFacade {
  private readonly currentUserStore = inject(CurrentUserStoreService);

  private readonly profilePreferences = inject(ProfilePreferencesService);
  private readonly intentState = inject(IntentStateService);
  private readonly matchProfileBuilder = inject(MatchProfileBuilderService);
  private readonly capabilities = inject(PreferencesCapabilityService);

  /**
   * Fonte canônica do usuário logado.
   * undefined (hydrating) é normalizado para null para simplificar a VM.
   */
  readonly currentUser$: Observable<IUserDados | null> = this.currentUserStore.user$.pipe(
    map((user) => user ?? null),
    distinctUntilChanged((a, b) => (a?.uid ?? null) === (b?.uid ?? null)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly currentUid$: Observable<string | null> = this.currentUser$.pipe(
    map((user) => user?.uid?.trim() || null),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * VM do usuário logado, útil para telas "Minhas preferências".
   */
  readonly currentPreferencesVm$: Observable<PreferencesViewModel | null> = this.currentUser$.pipe(
    map((user) => user?.uid?.trim() || null),
    distinctUntilChanged(),
    switchMapSafe((uid) => {
      if (!uid) return of(null);
      return this.getPreferencesVmByUid$(uid);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * VM por uid explícito.
   * Útil para telas futuras de visualização pública/privada do domínio preferences.
   */
  getPreferencesVmByUid$(uid: string): Observable<PreferencesViewModel> {
    const safeUid = this.normalizeUid(uid);

    return combineLatest([
      this.currentUser$,
      this.profilePreferences.getProfile$(safeUid),
      this.intentState.getIntentState$(safeUid),
    ]).pipe(
      map(([currentUser, profile, intent]) => {
        const isCurrentUser = currentUser?.uid === safeUid;
        const user = isCurrentUser ? currentUser : null;

        const capabilities = this.capabilities.getCapabilities(user);
        const matchProfile =
          user ? this.matchProfileBuilder.build(user, profile, intent) : null;

        return {
          uid: safeUid,
          user,
          profile,
          intent,
          matchProfile,
          capabilities,
        };
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  getCapabilities$(uid?: string | null): Observable<PreferencesCapabilitySnapshot> {
    const safeUid = this.normalizeUid(uid ?? '');

    if (!safeUid) {
      return this.currentUser$.pipe(
        map((user) => this.capabilities.getCapabilities(user)),
        shareReplay({ bufferSize: 1, refCount: true })
      );
    }

    return this.currentUser$.pipe(
      map((user) => (user?.uid === safeUid ? this.capabilities.getCapabilities(user) : this.capabilities.getCapabilities(null))),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private normalizeUid(uid: string): string {
    return (uid ?? '').trim();
  }
}

/**
 * Helper local para evitar importar switchMap em excesso só para um caso simples.
 * Mantém a facade mais legível.
 */
function switchMapSafe<T, R>(project: (value: T) => Observable<R>) {
  return (source: Observable<T>): Observable<R> =>
    new Observable<R>((subscriber) => {
      let innerSub: { unsubscribe(): void } | null = null;

      const outerSub = source.subscribe({
        next(value) {
          innerSub?.unsubscribe();
          innerSub = project(value).subscribe({
            next: (v) => subscriber.next(v),
            error: (e) => subscriber.error(e),
          });
        },
        error: (e) => subscriber.error(e),
        complete: () => subscriber.complete(),
      });

      return () => {
        innerSub?.unsubscribe();
        outerSub.unsubscribe();
      };
    });
}