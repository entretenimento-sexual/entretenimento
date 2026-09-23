import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CurrentUserStoreService } from '../../services/autentication/auth/current-user-store.service';
import {
  CURRENT_LEGAL_ACCEPTANCE_ENFORCED,
  TERMS_ACCEPTANCE_VERSION,
} from '../../services/compliance/terms-acceptance.service';
import { currentTermsGuard } from './current-terms.guard';

describe('currentTermsGuard', () => {
  let user$: BehaviorSubject<any>;
  let createUrlTree: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    user$ = new BehaviorSubject({
      uid: 'user-1',
      acceptedTerms: {
        accepted: true,
        version: TERMS_ACCEPTANCE_VERSION,
        acknowledgedPrivacyNotice: true,
      },
    });
    createUrlTree = vi.fn((commands, options) => ({ commands, options }));

    TestBed.configureTestingModule({
      providers: [
        {
          provide: Router,
          useValue: { createUrlTree },
        },
        {
          provide: CurrentUserStoreService,
          useValue: { user$: user$.asObservable() },
        },
      ],
    });
  });

  it('mantém a etapa de consentimento acessível com termos atuais', async () => {
    const result = TestBed.runInInjectionContext(() =>
      currentTermsGuard(
        {} as never,
        { url: '/adulto/confirmar?redirectTo=%2Fdashboard%2Fprincipal' } as never
      )
    );

    await expect(firstValueFrom(result as never)).resolves.toBe(true);
  });

  it('redireciona termos pendentes em ambientes onde a política está ativa', async () => {
    if (!CURRENT_LEGAL_ACCEPTANCE_ENFORCED) {
      return;
    }

    user$.next({
      uid: 'user-1',
      acceptedTerms: null,
    });

    const result = TestBed.runInInjectionContext(() =>
      currentTermsGuard(
        {} as never,
        { url: '/adulto/confirmar?redirectTo=%2Fdashboard%2Fprincipal' } as never
      )
    );

    await firstValueFrom(result as never);

    expect(createUrlTree).toHaveBeenCalledWith(
      ['/register/aceitar-termos'],
      {
        queryParams: {
          reason: 'material_terms_update_required',
          redirectTo: '/adulto/confirmar?redirectTo=%2Fdashboard%2Fprincipal',
        },
      }
    );
  });
});
