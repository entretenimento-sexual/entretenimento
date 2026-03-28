// src/app/preferences/services/match-profile-builder.service.ts
// Builder do documento derivado de matching/discovery.
//
// Responsabilidade:
// - transformar dados canônicos do usuário + preferências + intenção
//   em um documento otimizado para busca/ranking
// - não grava direto no Firestore
// - não depende da UI
//
// Observação:
// - role não é persistido aqui como fonte de verdade
// - role é consumido apenas para inferir "boosts" e capacidades derivadas

import { Injectable, inject } from '@angular/core';

import { IUserDados } from '@core/interfaces/iuser-dados';

import { IntentState } from '../models/intent-state.model';
import { MatchProfile } from '../models/match-profile.model';
import { PreferenceProfile } from '../models/preference-profile.model';
import { PreferencesCapabilityService } from './preferences-capability.service';

@Injectable({ providedIn: 'root' })
export class MatchProfileBuilderService {
  private readonly capabilities = inject(PreferencesCapabilityService);

  build(
    user: IUserDados,
    profile: PreferenceProfile,
    intent: IntentState
  ): MatchProfile {
    const capabilitySnapshot = this.capabilities.getCapabilities(user);

    return {
      userId: user.uid,
      search: {
        gender: user.gender ?? null,
        relationshipIntents: profile.relationshipIntents ?? [],
        sexualPractices: profile.softRules?.sexualPractices ?? [],
        city: user.municipio ?? null,
        state: user.estado ?? null,
        geohash: null,
        age: user.idade ?? null,
        availableNow: !!intent.availableNow,
        discoveryMode: profile.visibility.discoveryMode,
        profileCompleted: !!user.profileCompleted,
        emailVerified: !!user.emailVerified,
        isSubscriber: !!user.isSubscriber,
      },
      ranking: {
        responseScore: 0,
        trustScore: 0,
        activityScore: 0,
        compatibilityBoosts: this.buildCompatibilityBoosts(user, capabilitySnapshot),
      },
      updatedAt: Date.now(),
    };
  }

  private buildCompatibilityBoosts(
    user: Pick<IUserDados, 'role' | 'isSubscriber'>,
    capabilitySnapshot: ReturnType<PreferencesCapabilityService['getCapabilities']>
  ): string[] {
    const boosts: string[] = [];

    if (user.isSubscriber) {
      boosts.push('subscriber');
    }

    if (capabilitySnapshot.canUsePriorityVisibility) {
      boosts.push('priority_visibility_eligible');
    }

    if (capabilitySnapshot.canUseDiscreetMode) {
      boosts.push('discreet_mode_eligible');
    }

    if (capabilitySnapshot.canSeeCompatibilityInsights) {
      boosts.push('compatibility_insights_eligible');
    }

    if (user.role === 'vip') {
      boosts.push('vip');
    } else if (user.role === 'premium') {
      boosts.push('premium');
    } else if (user.role === 'basic') {
      boosts.push('basic');
    }

    return boosts;
  }
}