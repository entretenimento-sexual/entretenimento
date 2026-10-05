import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { BehaviorSubject, firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IUserAgeEligibility } from '../../interfaces/iuser-dados';
import { AuthSessionService } from '../../services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '../../services/autentication/auth/current-user-store.service';
import { AdultConsentService } from '../../services/compliance/adult-consent.service';
import { AgeEligibilityService } from '../../services/compliance/age-eligibility.service';
import {
  CURRENT_LEGAL_ACCEPTANCE_ENFORCED,
  TERMS_ACCEPTANCE_VERSION,
} from '../../services/compliance/terms-acceptance.service';
import { adultContentConsentGuard } from './adult-content-consent.guard';

const VERIFIED: IUserAgeEligibility = {
  status: 'VERIFIED_ADULT',
  policyVersion: 1,
  source: 'INITIAL_VERIFICATION',
  method: 'EXTERNAL_PROVIDER',
  verifiedAtMs: 1,
  expiresAtMs: null,
  updatedAtMs: 1,
};

describe('adultContentConsentGuard / account adult boundary', () => {
  let userSubject: BehaviorSubject<Record<string, unknown>>;
  let adultConsentSubject: BehaviorSubject<boolean>;
  let ageState: IUserAgeEligibility;
  let reconcileAge: ReturnType<typeof vi.fn>;
  let createUrlTree: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ageState = VERIFIED;
    userSubject = new BehaviorSubject<Record<string, unknown>>({
      uid: 'user-1',
      initialAdultConsentRequired: true,
      acceptedTerms: {
        accepted: true,
        version: TERMS_ACCEPTANCE_VERSION,
        acknowledgedPrivacyNotice: true,
      },
    });
    adultConsentSubject = new BehaviorSubject(false);
    reconcileAge = vi.fn(() => of(ageState));
    createUrlTree = vi.fn((commands, options) => ({ commands, options }));

    TestBed.configureTestingModule({
      providers: [
        {
          provide: Router,
          useValue: { createUrlTree },
        },
        {
          provide: AuthSessionService,
          useValue: { ready$: of(true), authUser$: of({ uid: 'user-1' }) },
        },
        {
          provide: CurrentUserStoreService,
          useValue: { user$: userSubject.asObservable() },
        },
        {
          provide: AdultConsentService,
          useValue: {
            currentConsentAccepted$: adultConsentSubject.asObservable(),
          },
        },
        {
          provide: AgeEligibilityService,
          useValue: {
            reconcileTrustedStateOncePerSession$: reconcileAge,
          },
        },
      ],
    });
  });

  it('permite acessar status da conta sem termos ou assurance adulta', () => {
    userSubject.next({ uid: 'user-1', acceptedTerms: null });

    const result = TestBed.runInInjectionContext(() =>
      adultContentConsentGuard(
        {} as never,
        { url: '/conta/status' } as never
      )
    );

    expect(result).toBe(true);
  });

  it('não bloqueia dev-real por aceite jurídico remoto indisponível quando assurance é válida', async () => {
    expect(CURRENT_LEGAL_ACCEPTANCE_ENFORCED).toBe(false);

    userSubject.next({
      uid: 'user-1',
      initialAdultConsentRequired: false,
      acceptedTerms: null,
    });

    const result = TestBed.runInInjectionContext(() =>
      adultContentConsentGuard(
        {} as never,
        { url: '/dashboard/principal' } as never
      )
    );

    await expect(firstValueFrom(result as never)).resolves.toBe(true);
  });

  it('redireciona para verificação confiável antes do consentimento', async () => {
    ageState = {
      status: 'SELF_DECLARED_ADULT',
      policyVersion: 1,
      source: 'SELF_DECLARATION',
      method: 'SELF_DECLARATION',
      verifiedAtMs: null,
      expiresAtMs: null,
      updatedAtMs: 2,
    };

    const result = TestBed.runInInjectionContext(() =>
      adultContentConsentGuard(
        {} as never,
        { url: '/chat' } as never
      )
    );

    await firstValueFrom(result as never);

    expect(createUrlTree).toHaveBeenCalledWith(
      ['/adulto/verificar-idade'],
      {
        queryParams: {
          reason: 'trusted_age_verification_required',
          redirectTo: '/chat',
        },
      }
    );
  });

  it('verifica consentimento depois da assurance confiável', async () => {
    const result = TestBed.runInInjectionContext(() =>
      adultContentConsentGuard(
        {} as never,
        { url: '/chat' } as never
      )
    );

    await firstValueFrom(result as never);

    expect(createUrlTree).toHaveBeenCalledWith(
      ['/adulto/confirmar'],
      {
        queryParams: {
          reason: 'initial_adult_consent_required',
          redirectTo: '/chat',
        },
      }
    );
  });

  it('libera recurso com assurance, termos e consentimento vigentes', async () => {
    adultConsentSubject.next(true);

    const result = TestBed.runInInjectionContext(() =>
      adultContentConsentGuard(
        {} as never,
        { url: '/descobrir' } as never
      )
    );

    await expect(firstValueFrom(result as never)).resolves.toBe(true);
    expect(createUrlTree).not.toHaveBeenCalled();
  });

  it('não exige nova verificação quando a reconciliação falha mas a projeção persistida ainda é confiável', async () => {
    adultConsentSubject.next(true);
    userSubject.next({
      uid: 'user-1',
      initialAdultConsentRequired: false,
      acceptedTerms: {
        accepted: true,
        version: TERMS_ACCEPTANCE_VERSION,
        acknowledgedPrivacyNotice: true,
      },
      ageEligibility: VERIFIED,
    });
    reconcileAge.mockReturnValueOnce(
      throwError(() => new Error('backend temporariamente indisponível'))
    );

    const result = TestBed.runInInjectionContext(() =>
      adultContentConsentGuard(
        {} as never,
        { url: '/dashboard/principal' } as never
      )
    );

    await expect(firstValueFrom(result as never)).resolves.toBe(true);
    expect(createUrlTree).not.toHaveBeenCalled();
  });

  it('não aplica bypass de conta a rota apenas parecida', async () => {
    const result = TestBed.runInInjectionContext(() =>
      adultContentConsentGuard(
        {} as never,
        { url: '/conta-falsa' } as never
      )
    );

    await firstValueFrom(result as never);

    expect(createUrlTree).toHaveBeenCalledWith(
      ['/adulto/confirmar'],
      expect.any(Object)
    );
  });
});
