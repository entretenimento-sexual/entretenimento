import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from '../../services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '../../services/autentication/auth/current-user-store.service';
import { AdultConsentService } from '../../services/compliance/adult-consent.service';
import {
  CURRENT_LEGAL_ACCEPTANCE_ENFORCED,
  TERMS_ACCEPTANCE_VERSION,
} from '../../services/compliance/terms-acceptance.service';
import { adultContentConsentGuard } from './adult-content-consent.guard';

describe('adultContentConsentGuard / documentos legais e controles essenciais', () => {
  let userSubject: BehaviorSubject<Record<string, unknown>>;
  let adultConsentSubject: BehaviorSubject<boolean>;
  let createUrlTree: ReturnType<typeof vi.fn>;

  beforeEach(() => {
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
      ],
    });
  });

  it('permite acessar status da conta sem termos ou consentimento de conteúdo', () => {
    userSubject.next({ uid: 'user-1', acceptedTerms: null });

    const result = TestBed.runInInjectionContext(() =>
      adultContentConsentGuard(
        {} as never,
        { url: '/conta/status' } as never
      )
    );

    expect(result).toBe(true);
  });

  it('não bloqueia o dev-real por aceite jurídico remoto indisponível', async () => {
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
    expect(createUrlTree).not.toHaveBeenCalled();
  });

  it('verifica consentimento adulto depois da política jurídica do ambiente', async () => {
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

  it('libera o recurso com termos atuais e consentimento adulto', async () => {
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

  it('não aplica o bypass de rota essencial a uma rota apenas parecida', async () => {
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
