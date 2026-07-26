// src/app/preferences/application/preferences.facade.ts
// Fachada de leitura do domínio de preferências.
//
// Objetivo:
// - expor uma VM única para telas do domínio preferences;
// - combinar usuário canônico + perfil + intenção + capacidades;
// - reagir a mudanças da projeção de assinatura sem recarregar a página;
// - manter a UI desacoplada dos services internos.

import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, of } from 'rxjs';
import {
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
} from 'rxjs/operators';

import { IUserDados } from '@core/interfaces/iuser-dados';
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { toEpoch } from '@core/utils/epoch-utils';

import { IntentState } from '../models/intent-state.model';
import { MatchProfile } from '../models/match-profile.model';
import { PreferenceProfile } from '../models/preference-profile.model';
import { IntentStateService } from '../services/intent-state.service';
import { MatchProfileBuilderService } from '../services/match-profile-builder.service';
import {
  PreferencesCapabilityService,
  PreferencesCapabilitySnapshot,
} from '../services/preferences-capability.service';
import { ProfilePreferencesService } from '../services/profile-preferences.service';

export interface PreferencesViewModel {
  uid: string;
  user: IUserDados | null;
  profile: PreferenceProfile;
  intent: IntentState;
  matchProfile: MatchProfile | null;
  capabilities: PreferencesCapabilitySnapshot;
}

function samePreferenceAccessUser(
  previous: IUserDados | null,
  current: IUserDados | null
): boolean {
  return (
    (previous?.uid ?? null) === (current?.uid ?? null) &&
    (previous?.role ?? null) === (current?.role ?? null) &&
    (previous?.tier ?? null) === (current?.tier ?? null) &&
    (previous?.billingProjectionVersion ?? null) ===
      (current?.billingProjectionVersion ?? null) &&
    previous?.isSubscriber === current?.isSubscriber &&
    (previous?.subscriptionStatus ?? null) ===
      (current?.subscriptionStatus ?? null) &&
    (previous?.subscriptionScope ?? null) ===
      (current?.subscriptionScope ?? null) &&
    toEpoch(previous?.subscriptionStartedAt) ===
      toEpoch(current?.subscriptionStartedAt) &&
    toEpoch(previous?.subscriptionEndsAt) ===
      toEpoch(current?.subscriptionEndsAt)
  );
}

@Injectable({ providedIn: 'root' })
export class PreferencesFacade {
  private readonly currentUserStore = inject(CurrentUserStoreService);

  private readonly profilePreferences = inject(ProfilePreferencesService);
  private readonly intentState = inject(IntentStateService);
  private readonly matchProfileBuilder = inject(MatchProfileBuilderService);
  private readonly capabilities = inject(PreferencesCapabilityService);

  readonly currentUser$: Observable<IUserDados | null> =
    this.currentUserStore.user$.pipe(
      map((user) => user ?? null),
      distinctUntilChanged(samePreferenceAccessUser),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly currentUid$: Observable<string | null> = this.currentUser$.pipe(
    map((user) => user?.uid?.trim() || null),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly currentPreferencesVm$: Observable<PreferencesViewModel | null> =
    this.currentUid$.pipe(
      switchMap((uid) => {
        if (!uid) return of(null);
        return this.getPreferencesVmByUid$(uid);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

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
        const matchProfile = user
          ? this.matchProfileBuilder.build(user, profile, intent)
          : null;

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

  getCapabilities$(
    uid?: string | null
  ): Observable<PreferencesCapabilitySnapshot> {
    const safeUid = this.normalizeUid(uid ?? '');

    if (!safeUid) {
      return this.currentUser$.pipe(
        map((user) => this.capabilities.getCapabilities(user)),
        shareReplay({ bufferSize: 1, refCount: true })
      );
    }

    return this.currentUser$.pipe(
      map((user) =>
        user?.uid === safeUid
          ? this.capabilities.getCapabilities(user)
          : this.capabilities.getCapabilities(null)
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private normalizeUid(uid: string): string {
    return (uid ?? '').trim();
  }
}
