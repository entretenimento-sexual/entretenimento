import { BehaviorSubject, firstValueFrom, of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { IUserAgeEligibility } from 'src/app/core/interfaces/iuser-dados';
import { RegisterFlowFacade } from './register-flow.facade';
import { RegisterNavigationService } from './register-navigation.service';

function facade(profileCompleted: boolean) {
  const reconcileAge = vi.fn(() => of<IUserAgeEligibility>({
    status: 'SELF_DECLARED_ADULT', policyVersion: 1,
    source: 'SELF_DECLARATION', method: 'SELF_DECLARATION',
    verifiedAtMs: null, expiresAtMs: null, updatedAtMs: 10,
  }));
  const authUser$ = new BehaviorSubject<{ uid: string; emailVerified: boolean } | null>({
    uid: 'adult-user', emailVerified: true,
  });
  const currentAge$ = new BehaviorSubject<IUserAgeEligibility>({
    status: 'UNVERIFIED', policyVersion: 1, source: 'INITIAL_VERIFICATION',
    method: 'MANUAL_REVIEW',
  });
  const user$ = new BehaviorSubject({
    uid: 'adult-user', emailVerified: true, profileCompleted,
    accountStatus: 'active', initialAdultConsentRequired: true,
    adultConsent: null,
    acceptedTerms: { accepted: true, version: 'v3', acknowledgedPrivacyNotice: true },
    ageEligibility: {
      status: 'EXPIRED', policyVersion: 1, source: 'INITIAL_VERIFICATION',
      method: 'MANUAL_REVIEW', verifiedAtMs: 1, expiresAtMs: 2,
    },
  });
  const vm = new RegisterFlowFacade(
    { ready$: of(true), authUser$ } as never,
    { user$ } as never,
    { reconcileTrustedStateOncePerSession$: reconcileAge, current$: currentAge$ } as never,
    new RegisterNavigationService()
  );
  return { vm, reconcileAge, authUser$, currentAge$, user$ };
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

  it('não reinicia a consulta quando a própria reconciliação atualiza o perfil', async () => {
    const { vm, reconcileAge, user$ } = facade(false);
    const pending = new Subject<IUserAgeEligibility>();
    reconcileAge.mockReturnValue(pending);
    const ready = firstValueFrom(vm.vm$);
    const previous = user$.value;

    user$.next({
      ...previous,
      ageEligibility: { ...previous.ageEligibility, expiresAtMs: 3 },
    });

    expect(reconcileAge).toHaveBeenCalledOnce();
    pending.next({
      status: 'SELF_DECLARED_ADULT', policyVersion: 1,
      source: 'SELF_DECLARATION', method: 'SELF_DECLARATION',
      verifiedAtMs: null, expiresAtMs: null, updatedAtMs: 10,
    });
    await expect(ready).resolves.toMatchObject({ currentStep: 'profileCompletion' });
  });
  it('desconsidera perfil antigo quando a identidade Firebase muda ou desaparece', async () => {
    const { vm, authUser$ } = facade(true);
    authUser$.next({ uid: 'other', emailVerified: false });
    await expect(firstValueFrom(vm.vm$)).resolves.toMatchObject({
      uid: 'other', emailVerified: false, userResolved: false, profileCompleted: false,
    });
    authUser$.next(null);
    await expect(firstValueFrom(vm.vm$)).resolves.toMatchObject({
      uid: null, userExists: false, currentStep: 'signup',
    });
  });

  it('avança após atualizar a decisão etária na mesma sessão', () => {
    const { vm, reconcileAge, currentAge$ } = facade(false);
    reconcileAge.mockReturnValueOnce(of({
      status: 'UNVERIFIED', policyVersion: 1, source: 'INITIAL_VERIFICATION',
      method: 'MANUAL_REVIEW', verifiedAtMs: null, expiresAtMs: null, updatedAtMs: 1,
    }));
    const steps: string[] = [];
    const subscription = vm.vm$.subscribe((state) => steps.push(state.currentStep));
    expect(steps.at(-1)).toBe('ageVerification');
    currentAge$.next({
      status: 'SELF_DECLARED_ADULT', policyVersion: 1, source: 'SELF_DECLARATION',
      method: 'SELF_DECLARATION', verifiedAtMs: null, expiresAtMs: null, updatedAtMs: 2,
    });
    expect(steps.at(-1)).toBe('profileCompletion');
    subscription.unsubscribe();
  });

});
