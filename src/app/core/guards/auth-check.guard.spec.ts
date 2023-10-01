import { TestBed } from '@angular/core/testing';
import { CanActivateFn } from '@angular/router';

import { authCheckGuard } from './auth-check.guard';

describe('authCheckGuard', () => {
  const executeGuard: CanActivateFn = (...guardParameters) => 
      TestBed.runInInjectionContext(() => authCheckGuard(...guardParameters));

  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('should be created', () => {
    expect(executeGuard).toBeTruthy();
  });
});
