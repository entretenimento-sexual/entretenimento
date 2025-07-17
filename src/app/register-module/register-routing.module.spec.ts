import { TestBed } from '@angular/core/testing';
import { RegisterRoutingModule } from './register-routing.module';

describe('RegisterRoutingModule', () => {
  let pipe: RegisterRoutingModule;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [RegisterRoutingModule] });
    pipe = TestBed.inject(RegisterRoutingModule);
  });

  it('can load instance', () => {
    expect(pipe).toBeTruthy();
  });
});
