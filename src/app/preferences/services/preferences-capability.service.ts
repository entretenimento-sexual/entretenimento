// src/app/preferences/services/preferences-capability.service.ts
// -----------------------------------------------------------------------------
// CAPACIDADES DE PREFERÊNCIAS
// -----------------------------------------------------------------------------
// A UI nunca concede recursos por role ou isSubscriber isolados.
// A assinatura válida vem exclusivamente da projeção canônica versionada do
// entitlement. O backend e as Rules continuam sendo a autoridade definitiva.
// -----------------------------------------------------------------------------

import { Injectable } from '@angular/core';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import {
  evaluatePlatformSubscriptionProjection,
  hasMinimumPlatformSubscriptionRole,
  PlatformSubscriptionRole,
} from 'src/app/core/services/subscriptions/platform-subscription-access.model';

import { PreferenceFeature } from '../models/preference.types';

export type PreferencesPlanRole =
  | 'free'
  | PlatformSubscriptionRole
  | 'admin';

export interface PreferencesCapabilitySnapshot {
  currentPlan: PreferencesPlanRole | null;
  currentPlanLabel: string;
  hasActiveSubscription: boolean;

  canEditCorePreferences: boolean;
  canEditIntentState: boolean;
  canEditAdvancedPreferences: boolean;
  canUseContextualIntent: boolean;

  canUseAdvancedDiscovery: boolean;
  canUseDiscreetMode: boolean;
  canUsePriorityVisibility: boolean;
  canUseIntentBoost: boolean;
  canSeeCompatibilityInsights: boolean;
}

type PlanResolution = {
  role: PreferencesPlanRole | null;
  activeSubscription: boolean;
};

const PLAN_LABELS: Readonly<Record<PreferencesPlanRole, string>> = Object.freeze({
  free: 'Gratuito',
  basic: 'Básico',
  premium: 'Premium',
  vip: 'VIP',
  admin: 'Administrador',
});

@Injectable({ providedIn: 'root' })
export class PreferencesCapabilityService {
  hasFeature(
    user: IUserDados | null | undefined,
    feature: PreferenceFeature
  ): boolean {
    if (!user?.uid) return false;

    const plan = this.resolvePlan(user);
    if (plan.role === 'admin') return true;

    switch (feature) {
      case 'advanced_preferences':
      case 'contextual_intent':
        return this.hasMinimumActivePlan(plan, 'basic');

      case 'advanced_discovery':
      case 'discreet_mode':
      case 'compatibility_insights':
        return this.hasMinimumActivePlan(plan, 'premium');

      case 'priority_visibility':
      case 'intent_boost':
        return this.hasMinimumActivePlan(plan, 'vip');

      default:
        return false;
    }
  }

  getCapabilities(
    user: IUserDados | null | undefined
  ): PreferencesCapabilitySnapshot {
    const plan = this.resolvePlan(user);
    const hasUser = Boolean(user?.uid);

    return {
      currentPlan: plan.role,
      currentPlanLabel: plan.role ? PLAN_LABELS[plan.role] : 'Sem sessão',
      hasActiveSubscription: plan.activeSubscription,

      // Preferências essenciais e disponibilidade básica não são paywall.
      canEditCorePreferences: hasUser,
      canEditIntentState: hasUser,

      // Matriz de produto:
      // Básico  -> preferências detalhadas e contexto de disponibilidade.
      // Premium -> descoberta avançada, modo discreto e compatibilidade.
      // VIP     -> prioridade de visibilidade e boost de intenção.
      canEditAdvancedPreferences: this.hasFeature(
        user,
        'advanced_preferences'
      ),
      canUseContextualIntent: this.hasFeature(user, 'contextual_intent'),
      canUseAdvancedDiscovery: this.hasFeature(user, 'advanced_discovery'),
      canUseDiscreetMode: this.hasFeature(user, 'discreet_mode'),
      canUsePriorityVisibility: this.hasFeature(
        user,
        'priority_visibility'
      ),
      canUseIntentBoost: this.hasFeature(user, 'intent_boost'),
      canSeeCompatibilityInsights: this.hasFeature(
        user,
        'compatibility_insights'
      ),
    };
  }

  private resolvePlan(user: IUserDados | null | undefined): PlanResolution {
    if (!user?.uid) {
      return { role: null, activeSubscription: false };
    }

    const rawRole = String(user.tier ?? user.role ?? '')
      .trim()
      .toLowerCase();

    if (rawRole === 'admin') {
      return { role: 'admin', activeSubscription: true };
    }

    const projection = evaluatePlatformSubscriptionProjection(user);

    if (projection.active && projection.role) {
      return {
        role: projection.role,
        activeSubscription: true,
      };
    }

    return { role: 'free', activeSubscription: false };
  }

  private hasMinimumActivePlan(
    plan: PlanResolution,
    minimum: PlatformSubscriptionRole
  ): boolean {
    if (!plan.activeSubscription) return false;
    if (plan.role === 'admin') return true;

    return hasMinimumPlatformSubscriptionRole(
      plan.role as PlatformSubscriptionRole | null,
      minimum
    );
  }
}
