import { Injectable, inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Observable, defer, of } from 'rxjs';
import { shareReplay } from 'rxjs/operators';

import type { IntentState } from '../models/intent-state.model';
import type { PreferenceProfile } from '../models/preference-profile.model';
import type { PreferencesCapabilitySnapshot } from '../services/preferences-capability.service';
import {
  createEmptyIntentState,
  createEmptyPreferenceProfile,
} from '../utils/preference-normalizers';

/**
 * Replacements exclusivos das configurações `preferences-visual`.
 *
 * Os builds normais não referenciam este arquivo. O objetivo é renderizar o
 * editor real em CI sem criar sessão, ler Firestore ou enfraquecer guards no
 * runtime publicado.
 */
export const authGuard: CanActivateFn = () => true;
export const accountLifecycleGuard: CanActivateFn = () => true;
export const adultContentConsentGuard: CanActivateFn = () => true;
export const ageReverificationGuard: CanActivateFn = () => true;
export const emailVerifiedGuard: CanActivateFn = () => true;

@Injectable({ providedIn: 'root' })
export class PreferencesEditorFacade {
  private readonly router = inject(Router);

  readonly currentEditorState$ = defer(() => of(this.buildState())).pipe(
    shareReplay({ bufferSize: 1, refCount: true })
  );

  saveProfileOnly$(
    _uid: string,
    _profile: PreferenceProfile
  ): Observable<void> {
    return of(void 0);
  }

  saveIntentOnly$(_uid: string, _intent: IntentState): Observable<void> {
    return of(void 0);
  }

  private buildState() {
    const uid = 'visual-preferences-user';
    const vip = this.router.url.includes('visualPlan=vip');
    const profile = createEmptyPreferenceProfile(uid);
    const intent = createEmptyIntentState(uid);

    profile.hardRules.ageRange = { min: 25, max: 45 };
    profile.hardRules.maxDistanceKm = 60;
    profile.hardRules.acceptsCouples = true;
    profile.hardRules.acceptsSingles = true;
    profile.visibility.showPreferenceBadges = true;

    intent.mode = vip ? 'dating' : 'chat';
    intent.availableToday = true;
    intent.cityOverride = vip ? 'Rio de Janeiro' : null;
    intent.tags = vip ? ['fim de semana', 'conversa'] : [];

    return {
      uid,
      user: null,
      profile,
      intent,
      capabilities: vip
        ? this.capabilities('vip')
        : this.capabilities('free'),
    };
  }

  private capabilities(
    plan: 'free' | 'vip'
  ): PreferencesCapabilitySnapshot {
    const vip = plan === 'vip';

    return {
      currentPlan: plan,
      currentPlanLabel: vip ? 'VIP' : 'Gratuito',
      hasActiveSubscription: vip,
      canEditCorePreferences: true,
      canEditIntentState: true,
      canEditAdvancedPreferences: vip,
      canRequireAdvancedPreferences: vip,
      canUseContextualIntent: vip,
      canUseAdvancedDiscovery: vip,
      canUseDiscreetMode: vip,
      canUsePriorityVisibility: vip,
      canUseIntentBoost: vip,
      canSeeCompatibilityInsights: vip,
    };
  }
}
