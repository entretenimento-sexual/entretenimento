import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Params,
  Router,
  RouterStateSnapshot,
  UrlTree,
  convertToParamMap,
  provideRouter,
} from '@angular/router';

import { legacyEmailVerificationReturnGuard } from './legacy-email-verification-return.guard';

describe('legacyEmailVerificationReturnGuard', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  function activate(queryParams: Params) {
    const route = { queryParamMap: convertToParamMap(queryParams) } as ActivatedRouteSnapshot;
    return TestBed.runInInjectionContext(() =>
      legacyEmailVerificationReturnGuard(route, {} as RouterStateSnapshot)
    );
  }

  it('encaminha o retorno sem código para a conferência no cadastro', () => {
    const result = activate({});

    expect(result).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree))
      .toBe('/register/welcome?autocheck=1');
  });

  it.each([
    { mode: 'verifyEmail', oobCode: 'email-code' },
    { mode: 'resetPassword', oobCode: 'reset-code' },
    { mode: 'verifyEmail' },
    { oobCode: 'missing-mode' },
  ])('delega links com parâmetros de ação ao handler existente', (params) => {
    expect(activate(params)).toBe(true);
  });
});
