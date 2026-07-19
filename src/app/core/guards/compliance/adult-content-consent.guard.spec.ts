import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import { AuthSessionService } from '../../services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '../../services/autentication/auth/current-user-store.service';
import { AdultConsentService } from '../../services/compliance/adult-consent.service';
import { adultContentConsentGuard } from './adult-content-consent.guard';

describe('adultContentConsentGuard / controles essenciais', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Router,
          useValue: { createUrlTree: () => ({ redirected: true }) },
        },
        {
          provide: AuthSessionService,
          useValue: { ready$: of(true), authUser$: of({ uid: 'user-1' }) },
        },
        {
          provide: CurrentUserStoreService,
          useValue: {
            user$: of({
              uid: 'user-1',
              initialAdultConsentRequired: true,
            }),
          },
        },
        {
          provide: AdultConsentService,
          useValue: { currentConsentAccepted$: of(false) },
        },
      ],
    });
  });

  it('permite acessar status da conta sem consentimento de conteúdo', () => {
    const result = TestBed.runInInjectionContext(() =>
      adultContentConsentGuard(
        {} as never,
        { url: '/conta/status' } as never
      )
    );

    expect(result).toBe(true);
  });

  it('não aplica o bypass a uma rota apenas parecida', () => {
    const result = TestBed.runInInjectionContext(() =>
      adultContentConsentGuard(
        {} as never,
        { url: '/conta-falsa' } as never
      )
    );

    expect(result).not.toBe(true);
  });
});
