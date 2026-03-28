// src/app/preferences/services/preferences-capability.service.ts
// Regras de capacidade do domínio de preferências/discovery.
// Role continua vindo de IUserDados.
// Este service não persiste nada: ele só decide o que o usuário pode usar.

import { Injectable } from '@angular/core';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { PreferenceFeature } from '../models/preference.types';

export interface PreferencesCapabilitySnapshot {
  canUseAdvancedDiscovery: boolean;
  canUseDiscreetMode: boolean;
  canUsePriorityVisibility: boolean;
  canUseIntentBoost: boolean;
  canEditAdvancedPreferences: boolean;
  canSeeCompatibilityInsights: boolean;
}

@Injectable({ providedIn: 'root' })
export class PreferencesCapabilityService {
  hasFeature(user: Pick<IUserDados, 'role' | 'isSubscriber'> | null | undefined, feature: PreferenceFeature): boolean {
    if (!user) return false;

    const role = user.role;
    const subscriber = !!user.isSubscriber;

    switch (feature) {
      case 'advanced_discovery':
        return role === 'premium' || role === 'vip' || subscriber;

      case 'discreet_mode':
        return role === 'basic' || role === 'premium' || role === 'vip' || subscriber;

      case 'priority_visibility':
        return role === 'premium' || role === 'vip' || subscriber;

      case 'intent_boost':
        return role === 'premium' || role === 'vip' || subscriber;

      case 'advanced_preferences':
        return role !== 'visitante';

      case 'compatibility_insights':
        return role === 'premium' || role === 'vip' || subscriber;

      default:
        return false;
    }
  }

  getCapabilities(user: Pick<IUserDados, 'role' | 'isSubscriber'> | null | undefined): PreferencesCapabilitySnapshot {
    return {
      canUseAdvancedDiscovery: this.hasFeature(user, 'advanced_discovery'),
      canUseDiscreetMode: this.hasFeature(user, 'discreet_mode'),
      canUsePriorityVisibility: this.hasFeature(user, 'priority_visibility'),
      canUseIntentBoost: this.hasFeature(user, 'intent_boost'),
      canEditAdvancedPreferences: this.hasFeature(user, 'advanced_preferences'),
      canSeeCompatibilityInsights: this.hasFeature(user, 'compatibility_insights'),
    };
  }
}