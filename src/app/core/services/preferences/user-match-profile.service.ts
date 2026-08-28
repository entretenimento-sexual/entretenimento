// Não esquecer comentários explicativos e ferramentas de debug
// cosiderar sempre o role do usuário para interações diversas e visualizações
// src/app/core/services/preferences/user-match-profile.service.ts
import { Injectable } from '@angular/core';

import { IUserDados } from '@core/interfaces/iuser-dados';
import { IUserIntentState } from '@core/interfaces/preferences/user-intent-state.interface';
import { IUserMatchProfile } from '@core/interfaces/preferences/user-match-profile.interface';
import { IUserPreferenceProfile } from '@core/interfaces/preferences/user-preference-profile.interface';

@Injectable({ providedIn: 'root' })
export class UserMatchProfileService {
  buildMatchProfile(
    user: IUserDados,
    preferences: IUserPreferenceProfile,
    intent: IUserIntentState
  ): IUserMatchProfile {
    return {
      userId: user.uid,
      searchable: {
        gender: (user as any)?.gender ?? null,
        relationshipIntents: preferences.relationshipIntent ?? [],
        practices: preferences.softPreferences?.practices ?? [],
        city: (user as any)?.municipio ?? null,
        state: (user as any)?.estado ?? null,
        geohash: (user as any)?.geohash ?? null,
        age: (user as any)?.idade ?? null,
        availableNow: intent.availableNow,
        discoveryMode: preferences.visibility.discoveryMode,
        profileCompleted: !!user.profileCompleted,
        emailVerified: !!user.emailVerified,
        isSubscriber: (user as any)?.isSubscriber ?? false,
      },
      ranking: {
        responseScore: 0,
        trustScore: 0,
        activityScore: 0,
        compatibilityBoosts: [],
      },
      updatedAt: Date.now(),
    };
  }
}