//src\app\guards\authentication.guard.spec.ts
import { TestBed } from '@angular/core/testing';
import { CanActivateFn } from '@angular/router';

import { AuthenticationGuard } from './authentication.guard';

describe('AuthenticationGuard', () => {
  let guard: AuthenticationGuard;
  const executeGuard: CanActivateFn = (...guardParameters) =>
    TestBed.runInInjectionContext(() => guard.canActivate(...guardParameters));

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AuthenticationGuard]
    });

    guard = TestBed.inject(AuthenticationGuard);
  });

  it('should be created', () => {
    expect(guard).toBeTruthy();
  });
});

