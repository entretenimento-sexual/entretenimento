import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { RegisterFlowFacade } from './register-flow.facade';
import { RegisterNavigationService } from './register-navigation.service';

function facade(profileCompleted: boolean) {
  const reconcileAge = vi.fn(() => of({
    status: 'SELF_DECLARED_ADULT', policyVersion: 1,
    source: 'SELF_DECLARATION', method: 'SELF_DECLARATION',
    verifiedAtMs: null, expiresAtMs: null, updatedAtMs: 10,
  }));
  const vm = new RegisterFlowFacade(
    { ready$: of(true), authUser$: of({uid:'adult-user',emailVerified:true}) } as never,
    { user$: of({
      uid: 'adult-user', emailVerified: true, profileCompleted,
      accountStatus: 'active', initialAdultConsentRequired: true,
      adultConsent: null,
      acceptedTerms: { accepted:true,version:'v3',acknowledgedPrivacyNotice:true },
      ageEligibility: { status:'EXPIRED', policyVersion:1,
        source:'INITIAL_VERIFICATION',method:'MANUAL_REVIEW',
        verifiedAtMs:1,expiresAtMs:2 },
    }) } as never,
    { reconcileTrustedStateOncePerSession$: reconcileAge } as never,
    new RegisterNavigationService()
  );
  return {vm,reconcileAge};
}
describe('registration admission without redundant adult consent', () => {
  it('não reabre idade ou consentimento em perfil admitido', async () => {
    const {vm,reconcileAge}=facade(true);
    const state=await firstValueFrom(vm.vm$);
    expect(state.currentStep).toBe('preferences');
    expect(reconcileAge).not.toHaveBeenCalled();
  });
  it('admite autodeclaração canônica e segue ao perfil', async () => {
    const {vm,reconcileAge}=facade(false);
    const state=await firstValueFrom(vm.vm$);
    expect(state.ageEligibilityAllowed).toBe(true);
    expect(state.currentStep).toBe('profileCompletion');
    expect(reconcileAge).toHaveBeenCalledTimes(1);
  });
});
