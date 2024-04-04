import { TestBed } from '@angular/core/testing';

import { PreRegisterService } from './pre-register.service';

describe('PreRegisterService', () => {
  let service: PreRegisterService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PreRegisterService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
