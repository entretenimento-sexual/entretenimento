import { TestBed } from '@angular/core/testing';

import { UsuarioStateService } from './usuario-state.service';

describe('UsuarioStateService', () => {
  let service: UsuarioStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(UsuarioStateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
