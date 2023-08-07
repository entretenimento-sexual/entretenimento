import { TestBed } from '@angular/core/testing';
import { CanActivateFn } from '@angular/router';

import { extaseGuard } from './extase.guard';

describe('extaseGuard', () => {
  const executeGuard: CanActivateFn = (...guardParameters) => 
      TestBed.runInInjectionContext(() => extaseGuard(...guardParameters));

  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('should be created', () => {
    expect(executeGuard).toBeTruthy();
  });
});
