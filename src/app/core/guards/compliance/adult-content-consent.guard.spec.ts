import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { BehaviorSubject, firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IUserAgeEligibility } from '../../interfaces/iuser-dados';
import { AuthSessionService } from '../../services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '../../services/autentication/auth/current-user-store.service';
import { AgeEligibilityService } from '../../services/compliance/age-eligibility.service';
import {
  CURRENT_LEGAL_ACCEPTANCE_ENFORCED,
  TERMS_ACCEPTANCE_VERSION,
} from '../../services/compliance/terms-acceptance.service';
import { adultContentConsentGuard } from './adult-content-consent.guard';

const VERIFIED: IUserAgeEligibility = {
  status: 'VERIFIED_ADULT', policyVersion: 1,
  source: 'INITIAL_VERIFICATION', method: 'EXTERNAL_PROVIDER',
  verifiedAtMs: 1, expiresAtMs: null, updatedAtMs: 1,
};
const DECLARED: IUserAgeEligibility = {
  status: 'SELF_DECLARED_ADULT', policyVersion: 1,
  source: 'SELF_DECLARATION', method: 'SELF_DECLARATION',
  verifiedAtMs: null, expiresAtMs: null, updatedAtMs: 2,
};
const CURRENT_TERMS = {
  accepted: true,
  version: TERMS_ACCEPTANCE_VERSION,
  acknowledgedPrivacyNotice: true,
};

describe('adultContentConsentGuard / admission 18+ and Terms without legacy consent', () => {
  let user$: BehaviorSubject<Record<string, unknown>>;
  let ageState: IUserAgeEligibility;
  let reconcileAge: ReturnType<typeof vi.fn>;
  let createUrlTree: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ageState = VERIFIED;
    user$ = new BehaviorSubject<Record<string, unknown>>({
      uid: 'user-1', acceptedTerms: CURRENT_TERMS,
      initialAdultConsentRequired: true,
      adultConsent: { accepted: false, version: 'v1' },
    });
    reconcileAge = vi.fn(() => of(ageState));
    createUrlTree = vi.fn((commands, options) => ({ commands, options }));
    TestBed.configureTestingModule({ providers: [
      { provide: Router, useValue: { createUrlTree } },
      { provide: AuthSessionService, useValue: {
        ready$: of(true), authUser$: of({ uid: 'user-1' }),
      } },
      { provide: CurrentUserStoreService, useValue: { user$: user$.asObservable() } },
      { provide: AgeEligibilityService, useValue: {
        reconcileTrustedStateOncePerSession$: reconcileAge,
      } },
    ] });
  });

  function run(url: string) {
    return TestBed.runInInjectionContext(() =>
      adultContentConsentGuard({} as never, { url } as never)
    );
  }

  it('mantém rotas de direitos da conta acessíveis', () => {
    user$.next({ uid: 'user-1', acceptedTerms: null });
    expect(run('/conta/status')).toBe(true);
  });

  it('permite admissão inicial canônica 18+ sem adultConsent legado', async () => {
    ageState = DECLARED;
    await expect(firstValueFrom(run('/chat') as never)).resolves.toBe(true);
    expect(reconcileAge).toHaveBeenCalledTimes(1);
    expect(createUrlTree).not.toHaveBeenCalled();
  });

  it('nega estado etário de menoridade confirmada', async () => {
    ageState = { ...DECLARED, status: 'DENIED_UNDERAGE',
      source: 'AGE_REVERIFICATION', method: 'MANUAL_REVIEW' };
    await firstValueFrom(run('/chat') as never);
    expect(createUrlTree).toHaveBeenCalledWith(['/adulto/verificar-idade'],
      expect.objectContaining({ queryParams: expect.objectContaining({ redirectTo: '/chat' }) }));
  });

  it('falha fechado no onboarding se a reconciliação canônica indisponível', async () => {
    user$.next({uid:'user-1',acceptedTerms:CURRENT_TERMS,ageEligibility:VERIFIED});
    reconcileAge.mockReturnValueOnce(throwError(() => new Error('offline')));
    await firstValueFrom(run('/chat') as never);
    expect(createUrlTree).toHaveBeenCalledWith(['/adulto/verificar-idade'],expect.any(Object));
  });

  it('não reinterpreta assurance de conta já admitida e ativa', async () => {
    user$.next({ uid: 'user-1', acceptedTerms: CURRENT_TERMS,
      accountStatus: 'active', profileCompleted: true,
      initialAdultConsentRequired: true, adultConsent: null,
      ageEligibility: { ...VERIFIED, status: 'EXPIRED' } });
    await expect(firstValueFrom(run('/dashboard/principal') as never)).resolves.toBe(true);
    expect(reconcileAge).not.toHaveBeenCalled();
    expect(createUrlTree).not.toHaveBeenCalled();
  });

  it('não confunde rota parecida com rota essencial da conta', async () => {
    ageState = { ...DECLARED, status: 'REVIEW_REQUIRED' };
    await firstValueFrom(run('/conta-falsa') as never);
    expect(createUrlTree).toHaveBeenCalledWith(['/adulto/verificar-idade'],expect.any(Object));
  });

  it('exige Termos vigentes quando o gating jurídico está ativo', async () => {
    user$.next({ uid: 'user-1', acceptedTerms: null,
      accountStatus: 'active', profileCompleted: true });
    const result = await firstValueFrom(run('/dashboard/principal') as never);
    if (CURRENT_LEGAL_ACCEPTANCE_ENFORCED) {
      expect(createUrlTree).toHaveBeenCalledWith(['/register/aceitar-termos'],expect.any(Object));
    } else {
      expect(result).toBe(true);
    }
  });
});
